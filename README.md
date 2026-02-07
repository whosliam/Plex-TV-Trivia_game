# Plex Tv Trivia Game

A web-based TV show trivia game using your Plex TV library. Watch episode clips and guess the show!

## Features

- Three difficulty levels
- Cross-device leaderboard
- Real-time video streaming
- 10 rounds per game
- Shows episode info (S1E5: Episode Title)

## Quick Start

```bash
git clone https://github.com/yourusername/binge-that-plex.git
cd binge-that-plex
```

Edit `docker-compose.yml` with your Plex URL and token, then:

```bash
docker-compose up -d
```

Access at: `http://localhost:3002`

## Companion Apps

- Music: Name That Plex (Port 3000)
- Movies: Scene That Plex (Port 3001)  
- TV: Binge That Plex (Port 3002)

## License

MIT License
