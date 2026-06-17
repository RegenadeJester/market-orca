import fs from 'fs';
let s = fs.readFileSync('server.js', 'utf8');

// Fix broken favicon strings (was {1F40B} after bad sed)
// These need the actual emoji character
s = s.replace(/\{1F40B\}/g, '🐋');

// Fix \\u{XXXX} in template literals -> actual emoji characters 
s = s.replace(/\\\\u\{1F4A1\}/g, '💡');
s = s.replace(/\\\\u\{1F9F9\}/g, '🧹');
s = s.replace(/\\\\u\{1F527\}/g, '🔧');
s = s.replace(/\\\\u\{1F9EC\}/g, '🛬');
s = s.replace(/\\\\u\{1F6E1\}/g, '🛡');
s = s.replace(/\\\\u\{1F4CA\}/g, '📊');
s = s.replace(/\\\\u\{1F30D\}/g, '🌍');
s = s.replace(/\\\\u\{2764\}/g, '❤');
s = s.replace(/\\\\uFE0F/g, '\uFE0F');

// Check for any remaining escaped unicode
const remaining = s.match(/\\\\u\{[0-9A-F]+\}/g);
if (remaining) console.log('REMAINING:', remaining);

fs.writeFileSync('server.js', s);
console.log('Done. File size:', s.length);
