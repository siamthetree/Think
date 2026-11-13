import fs from 'fs';
import path from 'path';

const ALLOWED_DOMAINS = new Set([
  'thedailystar.net',
  'www.thedailystar.net',
  'media.thedailystar.net',
  'prothomalo.com',
  'www.prothomalo.com',
  'en.prothomalo.com',
  'en.prothomalo.com.bd',
  'media.prothomalo.com.bd',
  'bdnews24.com',
  'media.bdnews24.com',
  'thefinancialexpress.com.bd',
  'tbsnews.net',
  'www.tbsnews.net',
  'dhakatribune.com',
  'www.dhakatribune.com',
  'jugantor.com',
  'www.jugantor.com',
  'kalerkantho.com',
  'www.kalerkantho.com',
  'samakal.com',
  'ittefaq.com.bd',
  'www.ittefaq.com.bd',
  'mzamin.com',
  'bonikbarta.com',
  'www.bonikbarta.com',
  'jaijaidinbd.com',
  'www.jaijaidinbd.com',
  'bhorerkagoj.com',
  'www.bhorerkagoj.com',
  'inquilab.com',
  'www.inquilab.com',
  'nayadiganta.com',
  'www.nayadiganta.com',
  'protidinersangbad.com',
  'www.protidinersangbad.com',
  'manobkantha.com.bd',
  'www.manobkantha.com.bd',
  'ajkerpatrika.com',
  'www.ajkerpatrika.com',
  'deshrupantor.com',
  'www.deshrupantor.com',
  'banglatribune.com',
  'www.banglatribune.com',
  'dhakapost.com',
  'www.dhakapost.com',
  'jagonews24.com',
  'www.jagonews24.com',
  'risingbd.com',
  'www.risingbd.com',
  'sarabangla.net',
  'barta24.com',
  'www.barta24.com',
  'newagebd.net',
  'www.newagebd.net',
  'bbci.co.uk',
  'feeds.bbci.co.uk',
  'ichef.bbci.co.uk',
  'bbc.com',
  'www.bbc.com',
  'bbc.co.uk',
  'www.bbc.co.uk',
  'news.bbc.co.uk',
  'reuters.com',
  'www.reuters.com',
  'theguardian.com',
  'www.theguardian.com',
  'i.guim.co.uk',
  'media.guim.co.uk',
  'aljazeera.com',
  'www.aljazeera.com',
  'dw.com',
  'rss.dw.com',
  'dw.de',
  'techcrunch.com',
  'theverge.com',
  'www.theverge.com',
  'hnrss.org',
  'arstechnica.com',
  'feeds.arstechnica.com',
  'wired.com',
  'www.wired.com',
  'technologyreview.com',
  'www.technologyreview.com',
  'economist.com',
  'ft.com',
  'bloomberg.com',
  'cnbc.com',
  'foreignpolicy.com',
  'aeon.co',
  'newyorker.com',
  'www.newyorker.com',
  'theatlantic.com',
  'www.theatlantic.com',
  'nautil.us',
  'quantamagazine.org',
  'www.quantamagazine.org',
  'nature.com',
  'www.nature.com',
  'newscientist.com',
  'www.newscientist.com',
  'phys.org',
  'sciencedaily.com',
  'www.sciencedaily.com',
  'nyt.com',
  'www.nytimes.com',
  'w3.org',
  'github.com',
  'githubusercontent.com',
  'react.dev',
  'reactjs.org',
  'developer.mozilla.org',
  'bugs.webkit.org',
  'capacitorjs.com',
  'tailwindcss.com',
  'vitejs.dev',
  'npmjs.com',
]);

const FORBIDDEN_STRINGS = ['firebase', 'googleapis', 'gstatic', 'ais-dev', 'ais-pre', 'run.app'];

function scanDir(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDir(fullPath, files);
    } else if (/\.(js|html|css|json)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

const distDir = path.join(process.cwd(), 'dist');
const files = scanDir(distDir);

if (files.length === 0) {
  console.error('Error: dist/ directory is empty or missing. Run npm run build first.');
  process.exit(1);
}

let hasError = false;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const lower = content.toLowerCase();

  for (const forbidden of FORBIDDEN_STRINGS) {
    if (lower.includes(forbidden)) {
      console.error(`Error: Found forbidden string "${forbidden}" in ${path.relative(process.cwd(), file)}`);
      hasError = true;
    }
  }

  const urlRegex = /https?:\/\/([a-zA-Z0-9.-]+)(?:\/[^\s"'<>`)]*)?/g;
  let match;
  while ((match = urlRegex.exec(content)) !== null) {
    const hostname = match[1].toLowerCase();
    const isAllowed = Array.from(ALLOWED_DOMAINS).some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
    if (!isAllowed) {
      console.error(`Error: Un-allowlisted external hostname "${hostname}" found in ${path.relative(process.cwd(), file)}`);
      hasError = true;
    }
  }
}

if (hasError) {
  console.error('Host check failed: Found forbidden strings or un-allowlisted hosts in build output.');
  process.exit(1);
} else {
  console.log('Host check passed successfully. Zero unauthorized hosts or forbidden tokens found.');
  process.exit(0);
}
