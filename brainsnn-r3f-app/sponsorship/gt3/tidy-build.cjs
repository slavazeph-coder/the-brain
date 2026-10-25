'use strict';
// Idempotent source presentation cleanup, invoked by the build below.
const fs=require('node:fs'),path=require('node:path');
for(const [name,pairs]of [['index.html',[['Your brand.<br><span>On the GT3.</span>','Your brand. <span>On the GT3.</span>']]],['style.css',[['height:90px','height:76px'],['padding:48px 0 30px','padding:32px 0 24px'],['font-size:clamp(48px,6.8vw,82px)','font-size:clamp(42px,5.4vw,66px)'],['h1{font-size:54px}','h1{font-size:46px}'],['body[data-render-state=ready] .loader{opacity:0}','body[data-render-state=ready] .loader{opacity:0;visibility:hidden}']]]]){const file=path.join(__dirname,'public',name);let value=fs.readFileSync(file,'utf8');for(const [a,b]of pairs)value=value.replace(a,b);fs.writeFileSync(file,value);}
