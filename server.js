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
      if (res.statusCode === 302 || res.statusCode === 301) {
        https.get(res.headers.location, res2 => {
          res2.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }).on('error', reject);
      } else {
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }
    }).on('error', err => { fs.unlink(dest, () => {}); reject(err); });
  });
}
 
async function searchAndDownloadGoalClip(homeTeam, awayTeam, scorer, minute, matchId) {
  try {
    const queries = [
      `FIFA World Cup 2026 ${scorer} goal ${homeTeam} ${awayTeam}`,
      `FIFA World Cup 2026 ${homeTeam} ${awayTeam} goal highlight`,
      `World Cup 2026 ${homeTeam} vs ${awayTeam} goal`
    ];
    for (const query of queries) {
      try {
        const rawFile = `/tmp/raw_${matchId}.mp4`;
        const ytCmd = `yt-dlp "ytsearch1:${query}" -f "best[height<=720][ext=mp4]/best[height<=720]/best" -o "${rawFile}" --no-playlist --socket-timeout 30 --max-downloads 1 --match-filter "duration < 180" --quiet`;
        execSync(ytCmd, { timeout: 60000 });
        if (fs.existsSync(rawFile)) {
          console.log('Downloaded clip for: ' + query);
          return rawFile;
        }
      } catch(e) {
        console.log('Search failed for: ' + query);
        continue;
      }
    }
    return null;
  } catch(e) {
    return null;
  }
}
 
async function getTeamPhoto(teamName) {
  try {
    const query = encodeURIComponent(teamName + ' national football team');
    const url = 'https://api.unsplash.com/search/photos?query=' + query + '&per_page=1&orientation=landscape';
    const response = await fetch(url, {
      headers: { 'Authorization': 'Client-ID ' + process.env.UNSPLASH_ACCESS_KEY }
    });
    const data = await response.json();
    return data.results && data.results[0] ? data.results[0].urls.regular : null;
  } catch(e) {
    return null;
  }
}
 
app.post('/process-goal', async (req, res) => {
  const {
    homeTeam = 'Home',
    awayTeam = 'Away',
    scorer = 'Unknown',
    minute = 0,
    homeScore = 0,
    awayScore = 0,
    matchId = Date.now()
  } = req.body;
 
  try {
    const outputDir = '/tmp/videos';
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
 
    const outputFile = outputDir + '/goal_' + matchId + '_' + Date.now() + '.mp4';
    const safeScorer = String(scorer).replace(/['":\\[\]]/g, '').trim();
    const safeHome = String(homeTeam).replace(/['":\\[\]]/g, '').trim();
    const safeAway = String(awayTeam).replace(/['":\\[\]]/g, '').trim();
    const scoreText = safeHome + ' ' + homeScore + ' - ' + awayScore + ' ' + safeAway;
    const scorerText = safeScorer + ' ' + minute + 'min';
 
    console.log('Searching for FIFA clip...');
    const clipPath = await searchAndDownloadGoalClip(homeTeam, awayTeam, scorer, minute, matchId);
 
    let ffmpegCmd;
 
    if (clipPath && fs.existsSync(clipPath)) {
      console.log('Using real FIFA clip');
      ffmpegCmd = 'ffmpeg -y -i ' + clipPath + ' -vf "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=720:1280,setpts=PTS/1.05,drawtext=text=\'GOAL\':fontcolor=yellow:fontsize=80:x=(w-text_w)/2:y=80:shadowcolor=black:shadowx=4:shadowy=4:box=1:boxcolor=black@0.5:boxborderw=10,drawtext=text=\'' + scorerText + '\':fontcolor=white:fontsize=50:x=(w-text_w)/2:y=180:box=1:boxcolor=red@0.8:boxborderw=10,drawtext=text=\'' + scoreText + '\':fontcolor=white:fontsize=40:x=(w-text_w)/2:y=260:box=1:boxcolor=black@0.7:boxborderw=8,drawtext=text=\'FIFA WORLD CUP 2026\':fontcolor=white:fontsize=28:x=(w-text_w)/2:y=1220:box=1:boxcolor=red@0.9:boxborderw=8" -af "atempo=1.05" -c:v libx264 -preset ultrafast -crf 28 -t 45 -r 24 ' + outputFile;
    } else {
      console.log('No clip found - trying team photo');
      const photoUrl = await getTeamPhoto(homeTeam);
      let photoPath = null;
 
      if (photoUrl) {
        photoPath = '/tmp/team_' + matchId + '.jpg';
        try {
          await downloadFile(photoUrl, photoPath);
          if (!fs.existsSync(photoPath)) photoPath = null;
        } catch(e) {
          photoPath = null;
          console.log('Photo download failed, using animated fallback');
        }
      }
 
      if (photoPath) {
        console.log('Using team photo background');
        ffmpegCmd = 'ffmpeg -y -loop 1 -i ' + photoPath + ' -f lavfi -i anullsrc=r=44100:cl=stereo -vf "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,boxblur=6:6,drawtext=text=\'GOAL\':fontcolor=yellow:fontsize=100:x=(w-text_w)/2:y=200:shadowcolor=black:shadowx=5:shadowy=5,drawtext=text=\'' + scorerText + '\':fontcolor=white:fontsize=55:x=(w-text_w)/2:y=360:box=1:boxcolor=red@0.8:boxborderw=12,drawtext=text=\'' + scoreText + '\':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=460:box=1:boxcolor=black@0.7:boxborderw=10,drawtext=text=\'FIFA WORLD CUP 2026\':fontcolor=white:fontsize=30:x=(w-text_w)/2:y=1200:box=1:boxcolor=red@0.9:boxborderw=8" -map 0:v -map 1:a -c:v libx264 -preset ultrafast -crf 28 -t 20 -r 24 -shortest ' + outputFile;
        if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
      } else {
        console.log('Using animated fallback');
        ffmpegCmd = 'ffmpeg -y -f lavfi -i color=c=0x1a1a2e:size=720x1280:rate=24 -f lavfi -i anullsrc=r=44100:cl=stereo -vf "drawtext=text=\'GOAL\':fontcolor=yellow:fontsize=120:x=(w-text_w)/2:y=250:shadowcolor=black:shadowx=6:shadowy=6,drawtext=text=\'' + scorerText + '\':fontcolor=white:fontsize=55:x=(w-text_w)/2:y=430:box=1:boxcolor=red@0.8:boxborderw=12,drawtext=text=\'' + scoreText + '\':fontcolor=white:fontsize=42:x=(w-text_w)/2:y=530:box=1:boxcolor=black@0.7:boxborderw=10,drawtext=text=\'FIFA WORLD CUP 2026\':fontcolor=white:fontsize=30:x=(w-text_w)/2:y=1200:box=1:boxcolor=red@0.9:boxborderw=8" -map 0:v -map 1:a -c:v libx264 -preset ultrafast -crf 28 -t 20 -r 24 -shortest ' + outputFile;
      }
    }
 
    execSync(ffmpegCmd, { timeout: 120000 });
    if (clipPath && fs.existsSync(clipPath)) fs.unlinkSync(clipPath);
 
    const filename = path.basename(outputFile);
    const videoUrl = req.protocol + '://' + req.get('host') + '/videos/' + filename;
    res.json({ success: true, videoUrl, scorer, minute, scoreDisplay: scoreText });
 
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});
 
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Running on port ' + PORT));
