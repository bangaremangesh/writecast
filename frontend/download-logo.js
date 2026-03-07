import https from 'https';
import fs from 'fs';

const file = fs.createWriteStream('public/logo.png');
https.get('https://writecast.in/logo.png', (response) => {
  response.pipe(file);
});
