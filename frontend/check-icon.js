import fs from 'fs';
import sizeOf from 'image-size';
const buffer = fs.readFileSync('public/logo.png');
console.log(sizeOf(buffer));
