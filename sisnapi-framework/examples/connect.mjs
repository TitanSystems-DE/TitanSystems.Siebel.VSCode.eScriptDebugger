import { Application } from '../dist/index.js';
const url = process.env.SIEBEL_URL ?? 'siebel://siebel.ttn-systems.de:2321/ENT/EAIObjMgr_enu';
const user = process.env.SIEBEL_USER, password = process.env.SIEBEL_PASSWORD;
if (!user || !password) throw new Error('Set SIEBEL_USER and SIEBEL_PASSWORD in the environment.');
const app = new Application();
try {
  await app.login(url, user, password);
  console.log('Login successful; server version:', await app.getServerVersion());
  // Optional read-only query; repository names and fields depend on your installation.
  if (process.env.SIEBEL_BUS_OBJECT && process.env.SIEBEL_BUS_COMP) {
    const bo = await app.getBusObject(process.env.SIEBEL_BUS_OBJECT);
    try {
      const bc = await bo.getBusComp(process.env.SIEBEL_BUS_COMP);
      await bc.activateField('Id'); await bc.clearToQuery();
      if (process.env.SIEBEL_SEARCH_EXPR) await bc.setSearchExpr(process.env.SIEBEL_SEARCH_EXPR);
      await bc.executeQuery(true);
      if (await bc.firstRecord()) console.log('First record Id:', await bc.getFieldValue('Id'));
    } finally { await bo.release(); }
  }
  await app.logoff(false);
} catch (error) { console.error(`${error.name}: ${error.message}`); process.exitCode = 1; }
finally { app.close(); }
