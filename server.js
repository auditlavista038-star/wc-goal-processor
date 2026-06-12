const express = require('express');
const cors = require('cors');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/videos', express.static('/tmp/videos'));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

async function getPlayerPhoto(playerName, teamName) {
  try {
    const query = encodeURIComponent(`${teamName} football soccer`);
    const url = `https://api.unsplash.com/search/photos?query=${query}&per_page=1&orientation=portrait`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` }
    });
    const data = await response.json();
    if (data.results && data.results.length > 0) {
      return data.results[0].urls.regular;
    }
    return null;
  } catch (e) { 
    return null; 
  }
}

app.post('/process-goal', async (req, res) => {
  const {
    homeTeam = 'Home Team',
    awayTeam = 'Away Team',
    scorer = 'Unknown',
    minute = 0,
    homeScore = 0,
    awayScore = 0,
    matchId = Date.now()
  } = req.body;

  try {
    const outputDir = '/tmp/videos';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputFile = `${outputDir}/goal_${matchId}_${Date.now()}.mp4`;

    // Safe text — remove special chars that break FFmpeg
    const safeScorer = (scorer || 'Unknown').replace(/[':]/g, ' ');
    const safeHome = (homeTeam || 'Home').replace(/[':]/g, ' ');
    const safeAway = (awayTeam || 'Away').replace(/[':]/g, ' ');
    const scoreText = `${safeHome} ${homeScore} - ${awayScore} ${safeAway}`;
    const scorerText = `GOAL  ${safeScorer}  ${minute} min`;

    // Try to get photo
    const photoUrl = await getPlayerPhoto(scorer, homeTeam);
    let photoPath = null;
    if (photoUrl) {
      photoPath = `/tmp/player_${matchId}.jpg`;
      try {
        await downloadFile(photoUrl, photoPath);
      } catch(e) {
        photoPath = null;
      }
    }

    let ffmpegCmd;

    if (photoPath && fs.existsSync(photoPath)) {
      // With photo background
      ffmpegCmd = `ffmpeg -y -loop 1 -i ${photoPath} \
  -f lavfi -i anullsrc=r=44100:cl=stereo \
  -vf "scale=720:1280:force_original_aspect_ratio=increase,\
crop=720:1280,\
boxblur=8:8,\
drawtext=text='GOAL':fontcolor=yellow:fontsize=100:x=(w-text_w)/2:y=150:shadowcolor=black:shadowx=4:shadowy=4,\
drawtext=text='${scorerText}':fontcolor=white:fontsize=50:x=(w-text_w)/2:y=300:box=1:boxcolor=red@0.8:boxborderw=10,\
drawtext=text='${scoreText}':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=400:box=1:boxcolor=black@0.7:boxborderw=8,\
drawtext=text='FIFA WORLD CUP 2026':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=1200:box=1:boxcolor=red@0.9:boxborderw=8" \
  -map 0:v -map 1:a \
  -c:v libx264 -preset ultrafast -crf 28 -t 15 -r 24 \
  -shortest ${outputFile}`;
    } else {
      // Plain background fallback
      ffmpegCmd = `ffmpeg -y \
  -f lavfi -i color=c=0x1a1a2e:size=720x1280:rate=24 \
  -f lavfi -i anullsrc=r=44100:cl=stereo \
  -vf "drawtext=text='GOAL':fontcolor=yellow:fontsize=120:x=(w-text_w)/2:y=200:shadowcolor=black:shadowx=5:shadowy=5,\
drawtext=text='${scorerText}':fontcolor=white:fontsize=50:x=(w-text_w)/2:y=380:box=1:boxcolor=red@0.8:boxborderw=10,\
drawtext=text='${scoreText}':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=480:box=1:boxcolor=black@0.7:boxborderw=8,\
drawtext=text='FIFA WORLD CUP 2026':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=1200:box=1:boxcolor=red@0.9:boxborderw=8" \
  -map 0:v -map 1:a \
  -c:v libx264 -preset ultrafast -crf 28 -t 15 -r 24 \
  -shortest ${outputFile}`;
    }

    execSync(ffmpegCmd, { timeout: 120000 });

    if (photoPath && fs.existsSync(photoPath)) {
      fs.unlinkSync(photoPath);
    }

    const filename = path.basename(outputFile);
    const videoUrl = `${req.protocol}://${req.get('host')}/videos/${filename}`;

    console.log(`Video ready: ${videoUrl}`);

    res.json({
      success: true,
      videoUrl,
      scorer,
      minute,
      scoreDisplay: scoreText
    });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
