const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const sharp=require('sharp');
const root=__dirname;
async function main(){
  const names=JSON.parse(fs.readFileSync(path.join(root,'design-source.json'))).assets.map(a=>a.name);
  const manifest=await Promise.all(names.map(async name=>{
    const output=path.join(root,name+'.png');
    await sharp(path.join(root,name+'.svg'),{limitInputPixels:100000000})
      .flatten({background:'#F7F9FD'}).removeAlpha().png().toFile(output);
    const m=await sharp(output).metadata();
    const expected=name.startsWith('header')?[3840,1646]:name.startsWith('search')?[3840,2560]:[1206,2622];
    if(m.width!==expected[0]||m.height!==expected[1]||m.hasAlpha)throw new Error('Invalid asset: '+name);
    return {file:name+'.png',width:m.width,height:m.height,alpha:false,
      sha256:crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex')};
  }));
  const tiles=await Promise.all(names.slice(0,6).map(async(name,i)=>({
    input:await sharp(path.join(root,name+'.png')).resize(302,657).toBuffer(),left:i*320,top:0,
  })));
  await sharp({create:{width:1920,height:657,channels:3,background:'#E7ECF3'}})
    .composite(tiles).jpeg({quality:92}).toFile(path.join(root,'preview-screenshots.jpg'));
  const reviewTiles=await Promise.all(names.slice(0,6).map(async(name,i)=>({
    input:await sharp(path.join(root,name+'.png')).resize(402,874).toBuffer(),
    left:(i%3)*426,top:Math.floor(i/3)*898,
  })));
  await sharp({create:{width:1278,height:1796,channels:3,background:'#E7ECF3'}})
    .composite(reviewTiles).jpeg({quality:92}).toFile(path.join(root,'review-6-screens.jpg'));
  for(const name of ['header','search']){
    const file=names.find(n=>n.startsWith(name));
    await sharp(path.join(root,file+'.png')).resize(name==='header'?1440:900).jpeg({quality:92})
      .toFile(path.join(root,'preview-'+name+'.jpg'));
  }
  fs.writeFileSync(path.join(root,'asset-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log('Verified 8 RGB PNGs:',manifest.map(x=>x.file).join(', '));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
