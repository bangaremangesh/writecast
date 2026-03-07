import https from 'https';

https.get('https://writecast.in/logo.png', (res) => {
  console.log('Status:', res.statusCode);
});
