const https = require('https');
const url = require('url');

function sendWebhook(embeds) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  const data = JSON.stringify({ embeds });
  const parsedUrl = url.parse(webhookUrl);

  const options = {
    hostname: parsedUrl.hostname,
    path: parsedUrl.path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };

  const req = https.request(options, (res) => {
    // Ignore response
  });

  req.on('error', (e) => {
    console.error('Discord webhook error:', e);
  });

  req.write(data);
  req.end();
}

module.exports = {
  sendFirstBlood: (teamName, challengeTitle, points) => {
    sendWebhook([{
      title: '🩸 FIRST BLOOD!',
      description: `**${teamName}** just got First Blood on **${challengeTitle}**! (+${points} pts bounty)`,
      color: 0xff0000,
      timestamp: new Date().toISOString()
    }]);
  },
  sendAnomaly: (categoryName, multiplier, durationMinutes) => {
    sendWebhook([{
      title: '⚠️ SURGE ANOMALY DETECTED',
      description: `A **${multiplier}x** point multiplier is now active for **${categoryName}** challenges for the next **${durationMinutes}** minutes!`,
      color: 0xffaa00,
      timestamp: new Date().toISOString()
    }]);
  }
};
