// The trial is the production page with its own title and banner (build-preview.py). Those edits change the
// page's content version, so the asset versions, app version and inline-script hashes are stamped again here.
import {readFileSync} from 'node:fs';
import {versionAssets,hashCsp} from './release-html.mjs';
const versioned=versionAssets(readFileSync(0,'utf8'),name=>readFileSync(new URL('../'+name,import.meta.url)));
process.stdout.write(JSON.stringify({'index.html':hashCsp(versioned.html).html,'app-version.txt':versioned.id+'\n'}));
