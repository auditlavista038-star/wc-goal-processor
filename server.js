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

// Download file from URL
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, res => {
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}

// Search Unsplash for free player/stadium photos
async function getPlayerPhoto(playerName, teamName) {
  try {
    const query = encodeURIComponent(`${playerName} football soccer`);
    const url = `https://api.unsplash.com/search/photos?query=${query}&per_page=1&orientation=portrait`;
    
    const response = await fetch(url, {
      headers: { 'Authorization': `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` }
    });
    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      return data.results[0].urls.regular;
    }
    
    // Fallback: stadium photo
    const stadiumQuery = encodeURIComponent(`${teamName} football stadium`);
    const stadiumUrl = `https://api.unsplash.com/search/photos?query=${stadiumQuery}&per_page=1`;
    const stadiumRes = await fetch(stadiumUrl, {
      headers: { 'Authorization': `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}` }
    });
    const stadiumData = await stadiumRes.json();
    return stadiumData.results?.[0]?.urls?.regular ?? null;
  } catch (e) {
    return null;
  }
}

app.post('/process-goal', async (req, res) => {
  const { homeTeam, awayTeam, scorer, minute, homeScore, awayScore, matchId } = req.body;

  try {
    const outputDir = '/tmp/videos';
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outputFile = `${outputDir}/goal_${matchId}_${Date.now()}.mp4`;
    const scoreText = `${homeTeam} ${homeScore} - ${awayScore} ${awayTeam}`;
    const scorerText = `GOAL! ${scorer} ${minute}'`;

    // Get player photo
    const photoUrl = await getPlayerPhoto(scorer, homeTeam);
    let photoPath = null;

    if (photoUrl) {
      photoPath = `/tmp/player_${matchId}.jpg`;
      await downloadFile(photoUrl, photoPath);
    }

    // Download royalty-free crowd noise
    const audioPath = `/tmp/crowd_${matchId}.mp3`;
    const audioUrl = 'https://www.soundjay.com/human/sounds/crowd-cheer-1.mp3';
    try { await downloadFile(audioUrl, audioPath); } catch(e) {}

    const hasAudio = fs.existsSync(audioPath);
    const hasPhoto = photoPath && fs.existsSync(photoPath);

    // Generate cinematic Short with FFmpeg
    let ffmpegCmd;

    if (hasPhoto) {
      ffmpegCmd = `ffmpeg -y \
        -loop 1 -i ${photoPath} \
        ${hasAudio ? `-i ${audioPath}` : ''} \
        -vf "
          scale=1080:1920:force_original_aspect_ratio=increase,
          crop=1080:1920,
          boxblur=10:10,
          colorize=hue=200:saturation=0.3,
          drawtext=text='⚽ GOAL!':fontcolor=yellow:fontsize=120:x=(w-text_w)/2:y=300:shadowcolor=black:shadowx=4:shadowy=4:box=1:boxcolor=black@0.5:boxborderw=20,
          drawtext=text='${scorerText}':fontcolor=white:fontsize=72:x=(w-text_w)/2:y=500:shadowcolor=black:shadowx=3:shadowy=3:box=1:boxcolor=red@0.8:boxborderw=15,
          drawtext=text='${scoreText}':fontcolor=white:fontsize=56:x=(w-text_w)/2:y=650:box=1:boxcolor=black@0.7:boxborderw=12,
          drawtext=text='FIFA WORLD CUP 2026':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=1820:box=1:boxcolor=red@0.9:boxborderw=10
        " \
        ${hasAudio ? '-map 0:v -map 1:a -shortest' : ''} \
        -c:v libx264 -preset fast -crf 23 \
        -t 30 \
        -r 30 \
        ${outputFile}`;
    } else {
      // Pure graphic fallback — no photo
      ffmpegCmd = `ffmpeg -y \
        -f lavfi -i color=c=0x1a1a2e:size=1080x1920:rate=30 \
        ${hasAudio ? `-i ${audioPath}` : ''} \
        -vf "
          drawtext=text='⚽':fontsize=200:x=(w-text_w)/2:y=400:fontcolor=white,
          drawtext=text='GOAL!':fontcolor=yellow:fontsize=150:x=(w-text_w)/2:y=650:shadowcolor=black:shadowx=5:shadowy=5,
          drawtext=text='${scorer}':fontcolor=white:fontsize=80:x=(w-text_w)/2:y=850:box=1:boxcolor=red@0.8:boxborderw=15,
          drawtext=text='${minute} MINUTES':fontcolor=white:fontsize=60:x=(w-text_w)/2:y=980:box=1:boxcolor=black@0.6:boxborderw=12,
          drawtext=text='${scoreText}':fontcolor=white:fontsize=56:x=(w-text_w)/2:y=1100:box=1:boxcolor=black@0.7:boxborderw=12,
          drawtext=text='FIFA WORLD CUP 2026':fontcolor=white:fontsize=36:x=(w-text_w)/2:y=1820:box=1:boxcolor=red@0.9:boxborderw=10
        " \
        ${hasAudio ? '-map 0:v -map 1:a -shortest' : ''} \
        -c:v libx264 -preset fast -crf 23 \
        -t 30 \
        -r 30 \
        ${outputFile}`;
    }

    // Clean up the command (remove newlines for exec)
    const cleanCmd = ffmpegCmd.replace(/\n\s+/g, ' ').replace(/\s+/g, ' ');
    execSync(cleanCmd, { timeout: 120000 });

    // Cleanup temp files
    if (photoPath && fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
    if (hasAudio) fs.unlinkSync(audioPath);

    const filename = path.basename(outputFile);
    const videoUrl = `${req.protocol}://${req.get('host')}/videos/${filename}`;

    console.log(`✅ Video ready: ${videoUrl}`);

    res.json({
      success: true,
      videoUrl,
      scorer,
      minute,
      scoreDisplay: scoreText
    });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`WC Goal Processor running on port ${PORT}`));
