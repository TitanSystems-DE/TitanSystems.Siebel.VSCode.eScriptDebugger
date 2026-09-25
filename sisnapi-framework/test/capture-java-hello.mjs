import net from 'node:net';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const java = process.env.JAVA_EXE ?? 'java';
const server = net.createServer(socket => {
  let all = Buffer.alloc(0);
  socket.on('data', chunk => {
    all = Buffer.concat([all, chunk]); const end = all.indexOf('\r\n\r\n');
    if (end < 0) return;
    const header = all.subarray(0, end).toString(); const length = Number(/Content-Length: (\d+)/i.exec(header)[1]);
    if (all.length < end + 4 + length) return;
    writeFileSync('test/fixtures/java-hello-wire.bin', all.subarray(end + 4));
    console.log(header); socket.destroy(); server.close();
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const child = spawn(java, ['-Dfile.encoding=UTF-8', '-cp', 'Siebel.jar;.research/classes', 'Probe', `siebel://127.0.0.1:${server.address().port}/ENT/EAIObjMgr_enu`], { stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', b => process.stdout.write(b)); child.stderr.on('data', b => process.stderr.write(b));
const timer = setTimeout(() => { child.kill(); server.close(); }, 15000); child.on('exit', () => clearTimeout(timer));
