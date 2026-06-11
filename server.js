const express = require('express');
const cors = require('cors');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve processed videos
app.use('/videos', express.static('/tmp/videos'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/process-goal', async (req, res) => {
  const {
    homeTeam,
    awayTeam,
    scorer,
    minute,
    homeScore,
    awayScore,
    matchId
  } = req.body;

  try {
    // Create output directory
    const outputDir = '/tmp/videos';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputFile = `${outputDir}/goal_${matchId}_${Date.now()}.mp4`;
    const searchQuery = `FIFA World Cup 2026 ${homeTeam} ${awayTeam} goal ${scorer}`;

    console.log(`Searching for: ${searchQuery}`);

    // Search and download FIFA clip
    const ytDlpCmd = `yt-dlp "ytsearch1:${searchQuery} site:youtube.com" \
      --match-filter "duration < 120" \
      -f "best[height<=720]" \
      -o "/tmp/raw_${matchId}.mp4" \
      --no-playlist \
      --socket-timeout 30`;

    execSync(ytDlpCmd, { timeout: 60000 });

    const rawFile = `/tmp/raw_${matchId}.mp4`;

    if (!fs.existsSync(rawFile)) {
      throw new Error('Download failed');
    }

    // FFmpeg: crop to vertical, add score overlay, speed up
    const scoreText = `${homeTeam} ${homeScore} - ${awayScore} ${awayTeam}`;
    const scorerText = `⚽ ${scorer} ${minute}'`;

    const ffmpegCmd = `ffmpeg -i ${rawFile} \
      -vf "crop=ih*9/16:ih:(iw-ih*9/16)/2:0, \
           scale=1080:1920, \
           setpts=PTS/1.1, \
           drawtext=text='${scoreText}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=100:box=1:boxcolor=black@0.6:boxborderw=10, \
           drawtext=text='${scorerText}':fontcolor=yellow:fontsize=56:x=(w-text_w)/2:y=180:box=1:boxcolor=black@0.6:boxborderw=10, \
           drawtext=text='FIFA WORLD CUP 2026':fontcolor=white:fontsize=32:x=(w-text_w)/2:y=1820:box=1:boxcolor=red@0.8:boxborderw=10" \
      -af "atempo=1.1" \
      -t 45 \
      -c:v libx264 \
      -preset fast \
      -crf 23 \
      ${outputFile} -y`;

    execSync(ffmpegCmd, { timeout: 120000 });

    // Clean up raw file
    fs.unlinkSync(rawFile);

    // Return video URL
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
    console.error('Processing error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WC Goal Processor running on port ${PORT}`);
});
