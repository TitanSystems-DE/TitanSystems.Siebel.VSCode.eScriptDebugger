import { SisnapiConnection } from '../dist/index.js';
const url = process.env.SIEBEL_URL ?? 'siebel://siebel.ttn-systems.de:2321/ENT/EAIObjMgr_enu';
const client = new SisnapiConnection({ requestTimeout: 10000 });
try { console.log(JSON.stringify(await client.probe(url, process.argv.includes('--session')), null, 2)); }
catch (error) { console.error(`${error.name}: ${error.message}`); process.exitCode = 1; }
finally { client.close(); }
