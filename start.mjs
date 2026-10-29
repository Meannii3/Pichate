import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from './server.mjs';
try{process.loadEnvFile('.env')}catch(error){if(error.code!=='ENOENT')throw error}
const directory=path.resolve(process.env.DATA_DIR||'data');await mkdir(directory,{recursive:true,mode:0o700});
if(!process.env.PUBLISHER_API_KEY){
 const keyFile=path.join(directory,'access-key');
 try{process.env.PUBLISHER_API_KEY=(await readFile(keyFile,'utf8')).trim()}
 catch(error){if(error.code!=='ENOENT')throw error;process.env.PUBLISHER_API_KEY=randomBytes(32).toString('hex');await writeFile(keyFile,process.env.PUBLISHER_API_KEY,{mode:0o600,flag:'wx'})}
 console.log('Private access key retained in DATA_DIR/access-key. Do not share it in chat.');
}
const server=createServer();server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Chaktorpai Publisher started on configured port.'));
