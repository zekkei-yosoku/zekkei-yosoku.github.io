// Fixed DEM bytes, real trial decoder and a reload while a live stream is held.
const {chromium,webkit}=require('playwright');
const assert=require('node:assert/strict');
const {gzipSync}=require('node:zlib');

const base=process.env.CANDIDATE_DECOMPRESSION_BASE||'http://127.0.0.1:8992/trial/';
const bytes=Buffer.alloc(256*256*4);
for(let offset=0;offset<bytes.length;offset+=4)bytes.writeInt32LE(12345,offset);
const terrain={zoom:0,tiles:[{x:0,y:0,offset:0}],heightsGzipBase64:gzipSync(bytes).toString('base64')};

async function verify(browser,engine){
 const context=await browser.newContext();
 try{
  await context.addInitScript(()=>{
   const Native=window.DecompressionStream,blobStream=Blob.prototype.stream;
   window.decodeAudit={hold:false,reading:false,blobStreams:0};
   Blob.prototype.stream=function(...args){
    decodeAudit.blobStreams++;
    return blobStream.apply(this,args);
   };
   window.DecompressionStream=function(format){
    const stream=new Native(format);
    if(!decodeAudit.hold)return stream;
    const readable=stream.readable.pipeThrough(new TransformStream({
     async transform(chunk,controller){
      decodeAudit.reading=true;
      await new Promise(resolve=>{decodeAudit.release=resolve;});
      controller.enqueue(chunk);
     }
    }));
    return {readable,writable:stream.writable};
   };
  });
  await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(base).origin?route.continue():route.abort());
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'index.html#/explore');
  const ready=()=>page.waitForFunction(()=>typeof AstroNotesCandidateTerrain?.decode==='function');
  await ready();
  await page.evaluate(terrain=>{
   decodeAudit.hold=true;
   void AstroNotesCandidateTerrain.decode(terrain).catch(error=>{decodeAudit.failure=String(error);});
  },terrain);
  await page.waitForFunction(()=>decodeAudit.reading||decodeAudit.failure);
  const old=await page.evaluate(()=>({reading:decodeAudit.reading,blobStreams:decodeAudit.blobStreams,error:decodeAudit.failure}));
  assert.deepEqual(old,{reading:true,blobStreams:0,error:undefined});
  await page.reload({waitUntil:'domcontentloaded'});
  await ready();
  const after=await page.evaluate(async terrain=>{
   let corruptRejected=false;
   const load=async()=>{const decoded=await AstroNotesCandidateTerrain.decode(terrain);return decoded.at({latitude:0,longitude:0});};
   try{await AstroNotesCandidateTerrain.decode({...terrain,heightsGzipBase64:'AQID'});}catch{corruptRejected=true;}
   return {heights:await Promise.all([load(),load()]),corruptRejected,blobStreams:decodeAudit.blobStreams};
  },terrain);
  assert.deepEqual(after,{heights:[123.45,123.45],corruptRejected:true,blobStreams:0});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({engine,activeAtReload:old.reading,...after}));
 }finally{
  await context.close();
 }
}
(async()=>{
 for(const [engine,type] of [['chrome',chromium],['webkit',webkit]]){
  const browser=await type.launch(engine==='chrome'?{channel:'chrome'}:{});
  try{await verify(browser,engine);}finally{await browser.close();}
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
