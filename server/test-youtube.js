require('dotenv').config();

async function test() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;

  console.log('Testing YouTube API...');
  console.log('Channel ID:', channelId);

  // Get channel info and uploads playlist ID
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,statistics&id=${channelId}&key=${apiKey}`;
  
  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    console.error('API Error:', data.error.message);
    process.exit(1);
  }

  if (!data.items || data.items.length === 0) {
    console.error('Channel not found — check your YOUTUBE_CHANNEL_ID');
    process.exit(1);
  }

  const channel = data.items[0];
  console.log('Channel name:', channel.snippet.title);
  console.log('Subscriber count:', channel.statistics.subscriberCount);
  console.log('Video count:', channel.statistics.videoCount);
  console.log('Uploads playlist ID:', channel.contentDetails.relatedPlaylists.uploads);
  console.log('YouTube API is working correctly');
}

test().catch(console.error);
