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
        -vf "scale=1080:1920:force_original_aspect_ratio=increase,\
crop=1080:1920,\
boxblur=10:10,\
drawtext=text='GOAL':fontcolor=yellow:fontsize=150:x=(w-text_w)/2:y=250:shadowcolor=black:shadowx=5:shadowy=5,\
drawtext=text='${scorerText}':fontcolor=white:fontsize=65:x=(w-text_w)/2:y=450:box=1:boxcolor=red@0.8:boxborderw=15,\
drawtext=text='${scoreText}':fontcolor=white:fontsize=55:x=(w-text_w)/2:y=600:box=1:boxcolor=black@0.7:boxborderw=12,\
drawtext=text='FIFA WORLD CUP 2026':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=1820:box=1:boxcolor=red@0.9:boxborderw=10" \
        -map 0:v -map 1:a \
        -c:v libx264 -preset fast -crf 23 -t 30 -r 30 \
        -shortest ${outputFile}`;
    } else {
      // Plain background fallback
      ffmpegCmd = `ffmpeg -y \
        -f lavfi -i color=c=0x1a1a2e:size=1080x1920:rate=30 \
        -f lavfi -i anullsrc=r=44100:cl=stereo \
        -vf "drawtext=text='GOAL':fontcolor=yellow:fontsize=180:x=(w-text_w)/2:y=300:shadowcolor=black:shadowx=6:shadowy=6,\
drawtext=text='${scorerText}':fontcolor=white:fontsize=65:x=(w-text_w)/2:y=550:box=1:boxcolor=red@0.8:boxborderw=15,\
drawtext=text='${scoreText}':fontcolor=white:fontsize=55:x=(w-text_w)/2:y=700:box=1:boxcolor=black@0.7:boxborderw=12,\
drawtext=text='FIFA WORLD CUP 2026':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=1820:box=1:boxcolor=red@0.9:boxborderw=10" \
        -map 0:v -map 1:a \
        -c:v libx264 -preset fast -crf 23 -t 30 -r 30 \
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
