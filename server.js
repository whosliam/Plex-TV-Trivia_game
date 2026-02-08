const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3002;

const PLEX_URL = process.env.PLEX_URL || 'http://localhost:32400';
const PLEX_TOKEN = process.env.PLEX_TOKEN || '';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    plexConfigured: !!PLEX_TOKEN,
    plexUrl: PLEX_URL 
  });
});

app.get('/api/plex/shows', async (req, res) => {
  try {
    if (!PLEX_TOKEN) {
      return res.status(400).json({ 
        error: 'Plex token not configured. Set PLEX_TOKEN environment variable.' 
      });
    }

    const librariesResponse = await axios.get(`${PLEX_URL}/library/sections`, {
      params: { 'X-Plex-Token': PLEX_TOKEN },
      timeout: 10000
    });

    const tvLibrary = librariesResponse.data.MediaContainer.Directory?.find(
      dir => dir.type === 'show'
    );

    if (!tvLibrary) {
      return res.status(404).json({ error: 'No TV show library found in Plex' });
    }

    const showsResponse = await axios.get(
      `${PLEX_URL}/library/sections/${tvLibrary.key}/all`,
      {
        params: { 'X-Plex-Token': PLEX_TOKEN },
        timeout: 30000
      }
    );

    const shows = showsResponse.data.MediaContainer.Metadata || [];
    console.log(`Found ${shows.length} TV shows`);

    // Get 3-5 random episodes from each show (no limit on shows)
    const episodePromises = shows.map(async (show) => {
      try {
        const episodesResponse = await axios.get(
          `${PLEX_URL}/library/metadata/${show.ratingKey}/allLeaves`,
          {
            params: { 'X-Plex-Token': PLEX_TOKEN },
            timeout: 10000
          }
        );
        
        const episodes = episodesResponse.data.MediaContainer.Metadata || [];
        if (episodes.length === 0) return [];
        
        // Get 3-5 random episodes from this show
        const numEpisodes = Math.min(episodes.length, Math.floor(Math.random() * 3) + 3);
        const selectedEpisodes = [];
        const shuffled = [...episodes].sort(() => Math.random() - 0.5);
        
        for (let i = 0; i < numEpisodes; i++) {
          const episode = shuffled[i];
          const partKey = episode.Media?.[0]?.Part?.[0]?.key;
          
          if (partKey) {
            selectedEpisodes.push({
              id: episode.ratingKey,
              showTitle: show.title,
              episodeTitle: episode.title,
              season: episode.parentIndex || null,
              episode: episode.index || null,
              year: show.year || null,
              duration: episode.duration || null,
              videoPath: partKey
            });
          }
        }
        
        return selectedEpisodes;
      } catch (err) {
        console.error(`Error fetching episodes for ${show.title}:`, err.message);
        return [];
      }
    });

    const episodeArrays = await Promise.all(episodePromises);
    const episodes = episodeArrays.flat();

    console.log(`Found ${episodes.length} TV episodes from ${shows.length} shows`);
    res.json({ episodes: episodes });

  } catch (error) {
    console.error('Error fetching Plex TV shows:', error.message);
    res.status(500).json({ 
      error: 'Failed to fetch TV shows from Plex', 
      details: error.message 
    });
  }
});

app.get('/api/plex/video/*', async (req, res) => {
  try {
    if (!PLEX_TOKEN) {
      return res.status(400).json({ error: 'Plex token not configured' });
    }

    const videoPath = req.params[0];
    const cleanPath = videoPath.startsWith('/') ? videoPath : `/${videoPath}`;
    const fullUrl = `${PLEX_URL}${cleanPath}`;

    console.log(`Streaming video from: ${fullUrl}`);
    console.log(`With token: ${PLEX_TOKEN.substring(0, 10)}...`);

    const headers = {};
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
      console.log(`Range request: ${req.headers.range}`);
    }

    const response = await axios({
      method: 'GET',
      url: fullUrl,
      params: { 'X-Plex-Token': PLEX_TOKEN },
      headers: headers,
      responseType: 'stream',
      timeout: 30000,
      validateStatus: (status) => status < 500
    });

    console.log(`Response status: ${response.status}`);

    res.status(response.status);
    res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    if (response.headers['content-range']) {
      res.setHeader('Content-Range', response.headers['content-range']);
    }
    res.setHeader('Accept-Ranges', 'bytes');

    response.data.pipe(res);

  } catch (error) {
    console.error('Error streaming video:', error.message);
    res.status(500).json({ 
      error: 'Failed to stream video from Plex',
      details: error.message 
    });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const LEADERBOARD_FILE = path.join(__dirname, 'data', 'leaderboard.json');

async function ensureDataDir() {
  try {
    await fs.mkdir(path.join(__dirname, 'data'), { recursive: true });
  } catch (err) {
    console.error('Error creating data directory:', err);
  }
}

async function loadLeaderboard() {
  try {
    const data = await fs.readFile(LEADERBOARD_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

async function saveLeaderboard(scores) {
  await ensureDataDir();
  await fs.writeFile(LEADERBOARD_FILE, JSON.stringify(scores, null, 2));
}

app.get('/api/leaderboard', async (req, res) => {
  try {
    const leaderboard = await loadLeaderboard();
    res.json(leaderboard);
  } catch (error) {
    console.error('Error loading leaderboard:', error);
    res.status(500).json({ error: 'Failed to load leaderboard' });
  }
});

app.post('/api/leaderboard', async (req, res) => {
  try {
    const { name, score, difficulty, timer, totalTime } = req.body;
    
    if (!name || score === undefined || !difficulty || !totalTime) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const leaderboard = await loadLeaderboard();
    
    // Difficulty multiplier
    const difficultyMultiplier = difficulty === 'easy' ? 1.0 : difficulty === 'medium' ? 1.5 : 2.0;
    const baseScore = (score * 100) - Math.floor(totalTime / 10);
    const compositeScore = Math.floor(baseScore * difficultyMultiplier);
    
    leaderboard.push({
      name: name.trim().substring(0, 20),
      score: score,
      difficulty: difficulty,
      totalTime: Math.floor(totalTime),
      compositeScore: compositeScore,
      date: new Date().toISOString()
    });
    
    leaderboard.sort((a, b) => {
      if (b.compositeScore !== a.compositeScore) {
        return b.compositeScore - a.compositeScore;
      }
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.totalTime - b.totalTime;
    });
    
    const topScores = leaderboard.slice(0, 20);
    await saveLeaderboard(topScores);
    
    res.json({ success: true, leaderboard: topScores });
  } catch (error) {
    console.error('Error saving score:', error);
    res.status(500).json({ error: 'Failed to save score' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`📺 TV Show Trivia Game server running on port ${PORT}`);
  console.log(`📡 Plex URL: ${PLEX_URL}`);
  console.log(`🔑 Plex Token: ${PLEX_TOKEN ? '✓ Configured' : '✗ Not configured'}`);
  console.log(`\n🌐 Access the game at: http://localhost:${PORT}`);
});
