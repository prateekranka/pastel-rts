(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))n(i);new MutationObserver(i=>{for(const o of i)if(o.type==="childList")for(const a of o.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&n(a)}).observe(document,{childList:!0,subtree:!0});function r(i){const o={};return i.integrity&&(o.integrity=i.integrity),i.referrerPolicy&&(o.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?o.credentials="include":i.crossOrigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function n(i){if(i.ep)return;i.ep=!0;const o=r(i);fetch(i.href,o)}})();const E=1,H=["friendly","opposing","neutral"],T=/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;function k(e){return T.test(e)&&e.length<=64}function q(e){return Number.isFinite(e.x)&&Number.isFinite(e.y)&&e.x>=0&&e.x<=1&&e.y>=0&&e.y<=1}function C(e){if(!S(e))throw new Error("Manifest must be an object");const t=e.schemaVersion;if(t!==E)throw new Error(`Unsupported schemaVersion: ${String(t)}`);const r=e.id;if(typeof r!="string"||!k(r))throw new Error("Invalid unit id");const n=e.displayName;if(typeof n!="string"||n.trim().length===0)throw new Error("displayName is required");if(typeof e.enabled!="boolean")throw new Error("enabled must be a boolean");const i=e.faction;if(!H.includes(i))throw new Error("Invalid faction");const o=e.assetPath;if(typeof o!="string"||o.trim().length===0)throw new Error("assetPath is required");if(o.includes("..")||o.startsWith("/")||!o.endsWith(".png"))throw new Error("assetPath must be a relative PNG path");const a=M(e.sourceWidth,"sourceWidth"),s=M(e.sourceHeight,"sourceHeight"),l=O(e.bounds,a,s),u=U(e.anchor),g=I(e.worldHeight,"worldHeight"),d=I(e.selectionRadius,"selectionRadius"),c=e.tags,m={schemaVersion:E,id:r,displayName:n.trim(),enabled:e.enabled,faction:i,assetPath:o,sourceWidth:a,sourceHeight:s,bounds:l,anchor:u,worldHeight:g,selectionRadius:d};if(c!==void 0){if(!Array.isArray(c)||c.some(f=>typeof f!="string"))throw new Error("tags must be an array of strings");m.tags=c}return m}function R(e){return C({...e,schemaVersion:e.schemaVersion??E})}function U(e){if(!S(e))throw new Error("anchor is required");const t={x:Number(e.x),y:Number(e.y)};if(!q(t))throw new Error("Invalid anchor");return t}function O(e,t,r){if(!S(e))throw new Error("bounds are required");const n={minX:y(e.minX,"bounds.minX"),minY:y(e.minY,"bounds.minY"),maxX:y(e.maxX,"bounds.maxX"),maxY:y(e.maxY,"bounds.maxY")};if(n.minX<0||n.minY<0||n.maxX>t||n.maxY>r)throw new Error("bounds exceed source dimensions");if(n.maxX<=n.minX||n.maxY<=n.minY)throw new Error("bounds must be non-empty");return n}function M(e,t){const r=y(e,t);if(r<=0)throw new Error(`${t} must be > 0`);return r}function y(e,t){if(typeof e!="number"||!Number.isInteger(e))throw new Error(`${t} must be an integer`);return e}function I(e,t){if(typeof e!="number"||!Number.isFinite(e)||e<=0)throw new Error(`${t} must be a positive number`);return e}function S(e){return typeof e=="object"&&e!==null&&!Array.isArray(e)}function A(e,t,r,n=8){let i=e,o=t,a=0,s=0;for(let l=0;l<t;l+=1)for(let u=0;u<e;u+=1)(r[(l*e+u)*4+3]??0)>n&&(i=Math.min(i,u),o=Math.min(o,l),a=Math.max(a,u+1),s=Math.max(s,l+1));return a<=i||s<=o?{minX:0,minY:0,maxX:e,maxY:t}:{minX:i,minY:o,maxX:a,maxY:s}}function $(e){return new Promise((t,r)=>{const n=URL.createObjectURL(e),i=new Image;i.onload=()=>{URL.revokeObjectURL(n),t(i)},i.onerror=()=>{URL.revokeObjectURL(n),r(new Error("Could not decode PNG"))},i.src=n})}function F(e){const t=document.createElement("canvas");t.width=e.naturalWidth,t.height=e.naturalHeight;const r=t.getContext("2d");if(!r)throw new Error("2D context unavailable");return r.drawImage(e,0,0),r.getImageData(0,0,t.width,t.height)}function G(e){return new Promise((t,r)=>{const n=new FileReader;n.onload=()=>{typeof n.result=="string"?t(n.result):r(new Error("Could not read PNG"))},n.onerror=()=>r(new Error("Could not read PNG")),n.readAsDataURL(e)})}function V(e,t,r,n,i,o){const a=e.getContext("2d");if(!a)return;a.imageSmoothingEnabled=!1,e.className=o;const s=i==="source"?192:i==="gameplay"?96:64;e.width=s,e.height=s,a.clearRect(0,0,s,s),a.fillStyle=o==="neutral"?"#8aa3a8":"transparent",o==="neutral"&&a.fillRect(0,0,s,s);const l=Math.max(1,r.maxX-r.minX),u=Math.max(1,r.maxY-r.minY),g=s*.78/Math.max(l,u),d=l*g,c=u*g,m=(s-d)*n.x,f=s-c-(1-n.y)*(s-c)*.15;a.drawImage(t,r.minX,r.minY,l,u,m,f,d,c),a.strokeStyle="#e07a3d",a.beginPath(),a.moveTo(m+d*n.x-4,f+c*n.y),a.lineTo(m+d*n.x+4,f+c*n.y),a.moveTo(m+d*n.x,f+c*n.y-4),a.lineTo(m+d*n.x,f+c*n.y+4),a.stroke()}const X=document.querySelector("#app");if(!X)throw new Error("#app missing");X.innerHTML=`
  <h1>Content Foundry</h1>
  <p class="lede">Milestone 0 path: upload one transparent PNG, configure a unit proxy, save it into the development content pack, and hot-reload it into game-web.</p>
  <div class="grid">
    <section>
      <h2>Import</h2>
      <label>Transparent PNG <input id="file" type="file" accept="image/png" /></label>
      <label>Stable unit ID <input id="id" value="foundry-proxy" /></label>
      <label>Display name <input id="name" value="Foundry Proxy" /></label>
      <label>Faction
        <select id="faction">
          <option value="friendly">friendly</option>
          <option value="opposing">opposing</option>
          <option value="neutral">neutral</option>
        </select>
      </label>
      <label>Anchor X (0–1) <input id="anchorX" type="number" min="0" max="1" step="0.05" value="0.5" /></label>
      <label>Anchor Y (0–1) <input id="anchorY" type="number" min="0" max="1" step="0.05" value="1" /></label>
      <label>World height <input id="worldHeight" type="number" min="0.1" step="0.1" value="1.6" /></label>
      <label>Selection radius <input id="radius" type="number" min="0.1" step="0.1" value="0.7" /></label>
      <button id="publish" type="button">Save to dev pack & notify game</button>
      <p class="status" id="status"></p>
    </section>
    <section>
      <h2>Preview</h2>
      <div class="previews">
        <div class="preview-card">
          <div>Source size</div>
          <canvas id="srcNeutral" class="neutral"></canvas>
          <canvas id="srcChecker" class="checker"></canvas>
        </div>
        <div class="preview-card">
          <div>Gameplay size</div>
          <canvas id="gameNeutral" class="neutral"></canvas>
          <canvas id="gameChecker" class="checker"></canvas>
        </div>
        <div class="preview-card">
          <div>70-percent camera</div>
          <canvas id="camNeutral" class="neutral"></canvas>
          <canvas id="camChecker" class="checker"></canvas>
        </div>
      </div>
      <h3>Manifest</h3>
      <pre id="manifest">No PNG loaded</pre>
    </section>
  </div>
`;let P=null,h=null,b=null;const x=document.querySelector("#file"),N=document.querySelector("#publish");var L;for(const e of["id","name","faction","anchorX","anchorY","worldHeight","radius"])(L=document.querySelector(`#${e}`))==null||L.addEventListener("input",Y);x==null||x.addEventListener("change",async e=>{var n;const t=e.target;if(!(t instanceof HTMLInputElement)||!((n=t.files)!=null&&n[0]))return;const r=t.files[0];try{h=await $(r),P=await G(r),p("PNG loaded. Bounds detected from non-transparent pixels.","ok"),Y()}catch(i){p(i instanceof Error?i.message:String(i),"error")}});N==null||N.addEventListener("click",()=>{D()});function Y(){if(h)try{const e=F(h),t=A(e.width,e.height,e.data),r=R({id:w("id"),displayName:w("name"),enabled:!0,faction:w("faction"),assetPath:`units/${w("id")}/sprite.png`,sourceWidth:h.naturalWidth,sourceHeight:h.naturalHeight,bounds:t,anchor:{x:v("anchorX"),y:v("anchorY")},worldHeight:v("worldHeight"),selectionRadius:v("radius"),tags:["foundry","proxy"]});b=r;const n=document.querySelector("#manifest");n&&(n.textContent=JSON.stringify(r,null,2));for(const[i,o,a]of[["srcNeutral","source","neutral"],["srcChecker","source","checker"],["gameNeutral","gameplay","neutral"],["gameChecker","gameplay","checker"],["camNeutral","seventy","neutral"],["camChecker","seventy","checker"]]){const s=document.querySelector(`#${i}`);s instanceof HTMLCanvasElement&&V(s,h,t,r.anchor,o,a)}p("Manifest valid.","ok")}catch(e){b=null,p(e instanceof Error?e.message:String(e),"error")}}async function D(){if(!b||!P){p("Load a valid PNG first.","error");return}try{const e=await fetch("/dev-content/units",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({manifest:b,pngBase64:P})}),t=await e.json();if(!e.ok)throw new Error(W(t));p(`Saved ${b.id} to content/dev-pack and notified listeners.`,"ok")}catch(e){p(`${e instanceof Error?e.message:String(e)} — is the content server running on port 8787?`,"error")}}function w(e){const t=document.querySelector(`#${e}`);return t instanceof HTMLInputElement||t instanceof HTMLSelectElement?t.value:""}function v(e){return Number(w(e))}function p(e,t){const r=document.querySelector("#status");r instanceof HTMLElement&&(r.textContent=e,r.className=`status ${t}`)}function W(e){return e&&typeof e=="object"&&"error"in e&&typeof e.error=="string"?e.error:"Publish failed"}
