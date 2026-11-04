(() => {
'use strict';

/* Single source of truth for pricing + content. Amounts MUST be recomputed on the server. */
const ENTRIES = {
  solo: { label:'Solo Spotlight', fee:499, blurb:'One dancer. One room. Two minutes.',
          perks:['One participant','Choose your dance style','Secure online payment'] },
  duo:  { label:'Duo Sync', fee:799, blurb:'Two dancers, one routine, one pulse.',
          perks:['Two participants','Choose your dance style','Secure online payment'] },
  group: { label:'Crew Mode', fee:1299, blurb:'Three to eight dancers. Own the whole floor.',
          perks:['3–8 participants','Team / act name','Secure online payment'] },
  formation: { label:'Big Formation', fee:1799, blurb:'Nine to fifteen dancers. Move as one.',
          perks:['9–15 participants','Team / act name','Secure online payment'] }
};
const SLOTS = [
  {id:'PNQ-1',city:'Pune',     date:'2026-12-12',time:'10:00',left:18,total:30},
  {id:'PNQ-2',city:'Pune',     date:'2026-12-12',time:'15:00',left:6, total:30},
  {id:'PNQ-3',city:'Pune',     date:'2026-12-13',time:'10:00',left:22,total:30},
  {id:'BOM-1',city:'Mumbai',   date:'2026-12-19',time:'10:00',left:11,total:30},
  {id:'BOM-2',city:'Mumbai',   date:'2026-12-19',time:'15:00',left:3, total:30},
  {id:'BOM-3',city:'Mumbai',   date:'2026-12-20',time:'10:00',left:24,total:30},
  {id:'DEL-1',city:'Delhi',    date:'2027-01-09',time:'10:00',left:16,total:30},
  {id:'DEL-2',city:'Delhi',    date:'2027-01-09',time:'15:00',left:9, total:30},
  {id:'DEL-3',city:'Delhi',    date:'2027-01-10',time:'10:00',left:20,total:30},
  {id:'BLR-1',city:'Bengaluru',date:'2027-01-16',time:'10:00',left:13,total:30},
  {id:'BLR-2',city:'Bengaluru',date:'2027-01-16',time:'15:00',left:7, total:30},
  {id:'BLR-3',city:'Bengaluru',date:'2027-01-17',time:'10:00',left:25,total:30}
];
const STYLES = [
  {n:'01',t:'Hip-Hop',s:'& Street',art:'rings', p:'Breaking, popping, locking, house. Raw groove, clean execution.',tags:['Breaking','Popping','Freestyle']},
  {n:'02',t:'Contemporary',s:'& Lyrical',art:'wave', p:'Floorwork, release, story. Movement that says what words can’t.',tags:['Lyrical','Modern','Jazz']},
  {n:'03',t:'Classical',s:'Fusion',art:'arcs', p:'Rooted in tradition, rebuilt for now. Bharatanatyam, Kathak and beyond.',tags:['Kathak','Bharatanatyam','Folk']},
  {n:'04',t:'Bollywood',s:'& Commercial',art:'lines', p:'Big energy, sharp counts, camera-ready presence.',tags:['Bollywood','Commercial','Jazz-funk']},
  {n:'05',t:'Crews',s:'& Choreo',art:'grid', p:'Four to twelve dancers. Formations, transitions, one idea executed together.',tags:['4–12 dancers','Staging','Concept']}
];
const STEPS = [
  {d:'12 Dec — 17 Jan',t:'City auditions',p:'Four cities, two minutes on the floor, a panel of three. Book a slot, show up, dance.'},
  {d:'06 Feb 2027',t:'Callbacks',p:'The top 120 dancers are announced within seven days of your audition. Workshops, a cypher, and a cut.'},
  {d:'27 Feb 2027',t:'Semi-finals',p:'Category battles on a live stage. Scored on technique, musicality and presence.'},
  {d:'14 Mar 2027',t:'Grand Finale',p:'Five categories, one night, one champion per floor. Cash prizes on stage.'}
];
const JUDGES = [
  {n:'Ira Kanwar',   r:'Contemporary',  c1:'#ff4a2b',c2:'#ffb199'},
  {n:'Rohan D’Souza',r:'Hip-Hop',       c1:'#ece7dd',c2:'#ff4a2b'},
  {n:'Meera Anand',  r:'Classical Fusion',c1:'#ffb199',c2:'#ece7dd'},
  {n:'Kabir Sethi',  r:'Crews & Choreo',c1:'#ff4a2b',c2:'#ece7dd'}
];

/* =====================================================================
   Helpers
   ===================================================================== */
const $  = (s,c=document)=>c.querySelector(s);
const $$ = (s,c=document)=>[...c.querySelectorAll(s)];
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
const inr = n=>'₹'+new Intl.NumberFormat('en-IN').format(n);
const fmtDate = iso=>new Date(iso+'T00:00:00Z').toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'});
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

gsap.registerPlugin(ScrollTrigger, SplitText, CustomEase);
CustomEase.create('offbeat','0.16,1,0.3,1');
ScrollTrigger.config({ignoreMobileResize:true});
if('scrollRestoration' in history) history.scrollRestoration='manual';
window.scrollTo(0,0);

/* =====================================================================
   Smooth scroll (Lenis) wired into GSAP's ticker
   ===================================================================== */
const lenis = reduce ? null : new Lenis({lerp:.09,smoothWheel:true});
if(lenis){
  lenis.on('scroll',ScrollTrigger.update);
  gsap.ticker.add(t=>lenis.raf(t*1000));
  gsap.ticker.lagSmoothing(0);
  lenis.stop();
}
const scrollTo = (target,opts={})=>{
  if(lenis) lenis.scrollTo(target,{duration:1.6,easing:t=>1-Math.pow(1-t,4),...opts});
  else (typeof target==='string'?$(target):target)?.scrollIntoView({behavior:'smooth'});
};

/* =====================================================================
   Build dynamic content
   ===================================================================== */
const ART = {
  rings:()=>Array.from({length:11},(_,i)=>`<circle cx="200" cy="200" r="${16+i*17}"/>`).join(''),
  lines:()=>Array.from({length:22},(_,i)=>`<line x1="${-20+i*20}" y1="400" x2="${180+i*20}" y2="0"/>`).join(''),
  wave:()=>Array.from({length:12},(_,i)=>{const y=40+i*28;return `<path d="M0 ${y} C 60 ${y-34}, 110 ${y+34}, 200 ${y} S 340 ${y-34}, 400 ${y}"/>`}).join(''),
  grid:()=>{let s='';for(let x=0;x<10;x++)for(let y=0;y<10;y++)s+=`<circle cx="${25+x*38}" cy="${25+y*38}" r="${1+((x*y)%4)}" fill="currentColor" stroke="none"/>`;return s},
  arcs:()=>Array.from({length:10},(_,i)=>`<path d="M${20+i*8} 380 A ${180-i*14} ${180-i*14} 0 0 1 380 ${20+i*8}"/>`).join('')
};

function buildStatic(){
  const minFee = Math.min(...Object.values(ENTRIES).map(e=>e.fee));
  $$('[data-fee-from]').forEach(e=>e.textContent=inr(minFee));

  $('#preWord').innerHTML = [...'OFFBEAT'].map(c=>`<span>${c}</span>`).join('');

  $('#track').innerHTML = STYLES.map(s=>`
    <article class="card" data-cursor="Style">
      <svg class="art" viewBox="0 0 400 400" fill="none" stroke="currentColor" stroke-width="1" aria-hidden="true">${ART[s.art]()}</svg>
      <span class="card-n mono">${s.n} / 05</span>
      <div><h3>${s.t}<span class="serif">${s.s}</span></h3><p>${s.p}</p>
      <div class="card-tags mono">${s.tags.map(t=>`<span>${t}</span>`).join('')}</div></div>
    </article>`).join('');

  $('#tl').insertAdjacentHTML('beforeend', STEPS.map((s,i)=>`
    <div class="tl-item"><span class="tl-date mono">${String(i+1).padStart(2,'0')} · ${s.d}</span>
    <div><h3>${s.t}</h3><p>${s.p}</p></div></div>`).join(''));

  $('#jList').innerHTML = JUDGES.map((j,i)=>`
    <div class="j-row" data-i="${i}" data-cursor="Judge"><span class="mono">0${i+1}</span><h3>${j.n}</h3><span class="j-role mono">${j.r}</span></div>`).join('');

  $('#passGrid').innerHTML = Object.entries(ENTRIES).map(([k,e])=>`
    <article class="pass" data-reveal data-cursor="Book" data-entry="${k}">
      <div><span class="mono">Pass</span><h3>${e.label}</h3><div class="pass-price">${inr(e.fee)}</div>
      <p style="opacity:.8;margin-bottom:18px">${e.blurb}</p></div>
      <div><ul>${e.perks.map(p=>`<li>${p}</li>`).join('')}</ul>
      <a class="btn" href="#" data-book data-entry="${k}">Book ${e.label} slot →</a></div>
    </article>`).join('');

  const cities=[...new Set(SLOTS.map(s=>s.city))];
  $('#cities').innerHTML = cities.map(c=>{
    const sl=SLOTS.filter(s=>s.city===c), left=sl.reduce((a,s)=>a+s.left,0), tot=sl.reduce((a,s)=>a+s.total,0);
    const dates=[...new Set(sl.map(s=>fmtDate(s.date)))].join(' · ');
    return `<div class="city" data-reveal data-city="${c}"><h4>${c}</h4><span class="mono">${dates}</span><div class="meter" data-fill="${(tot-left)/tot}"><i></i></div><span class="mono left" data-city-left="${c}">${left} spots left</span></div>`;
  }).join('');
}

/* =====================================================================
   Cursor + magnetic buttons
   ===================================================================== */
function initCursor(){
  if(coarse||reduce) return;
  document.documentElement.classList.add('has-cursor');
  const dot=$('.cur-dot'), ring=$('.cur-ring'), label=$('.cur-label');
  const dx=gsap.quickTo(dot,'x',{duration:.12,ease:'power3'}), dy=gsap.quickTo(dot,'y',{duration:.12,ease:'power3'});
  const rx=gsap.quickTo(ring,'x',{duration:.55,ease:'power3'}), ry=gsap.quickTo(ring,'y',{duration:.55,ease:'power3'});
  let shown=false;
  addEventListener('pointermove',e=>{
    if(!shown){shown=true;gsap.set([dot,ring],{x:e.clientX,y:e.clientY});gsap.to([dot,ring],{opacity:1,duration:.4});}
    dx(e.clientX);dy(e.clientY);rx(e.clientX);ry(e.clientY);
  });
  document.addEventListener('pointerover',e=>{
    const t=e.target.closest('[data-cursor]');
    if(t){label.textContent=t.dataset.cursor;ring.classList.add('on');gsap.to(ring,{scale:2.1,duration:.5,ease:'offbeat'});gsap.to(dot,{scale:0,duration:.3});}
    else if(e.target.closest('a,button')){gsap.to(ring,{scale:1.5,duration:.4,ease:'offbeat'});}
  });
  document.addEventListener('pointerout',e=>{
    const t=e.relatedTarget;
    if(!t||!t.closest||!t.closest('[data-cursor],a,button')){ring.classList.remove('on');gsap.to(ring,{scale:1,duration:.5,ease:'offbeat'});gsap.to(dot,{scale:1,duration:.3});}
  });
}
function initMagnetic(){
  if(coarse||reduce) return;
  $$('.magnetic').forEach(el=>{
    const xTo=gsap.quickTo(el,'x',{duration:.6,ease:'power3'}), yTo=gsap.quickTo(el,'y',{duration:.6,ease:'power3'});
    el.addEventListener('pointermove',e=>{const r=el.getBoundingClientRect();xTo((e.clientX-r.left-r.width/2)*.32);yTo((e.clientY-r.top-r.height/2)*.32);});
    el.addEventListener('pointerleave',()=>{gsap.to(el,{x:0,y:0,duration:1,ease:'elastic.out(1,.4)',overwrite:true});});
  });
}

/* =====================================================================
   Hero WebGL shader (Three.js) — flowing, mouse-reactive field
   ===================================================================== */
function initShader(){
  const canvas=$('#gl');
  if(!window.THREE) return null;
  let renderer;
  try{ renderer=new THREE.WebGLRenderer({canvas,antialias:false,alpha:false,powerPreference:'high-performance'}); }catch(e){ return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));
  const scene=new THREE.Scene(), cam=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const uniforms={uTime:{value:0},uRes:{value:new THREE.Vector2(1,1)},uMouse:{value:new THREE.Vector2(.5,.5)},uScroll:{value:0},uIntro:{value:reduce?1:0}};
  const mat=new THREE.ShaderMaterial({uniforms,
    vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.0);}`,
    fragmentShader:`
      precision highp float;
      uniform float uTime,uScroll,uIntro; uniform vec2 uRes,uMouse; varying vec2 vUv;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*noise(p);p*=2.02;a*=.5;}return v;}
      void main(){
        float asp=uRes.x/uRes.y;
        vec2 p=(vUv-.5)*vec2(asp,1.);
        vec2 m=(uMouse-.5)*vec2(asp,1.);
        float t=uTime*.08;
        vec2 q=vec2(fbm(p*1.6+t),fbm(p*1.6-t+3.));
        float f=fbm(p*1.8+q*1.9+t*1.5);
        float d=length(p-m);
        f+=.32*smoothstep(.55,.0,d);
        float bands=sin(f*10.+uTime*.22)*.5+.5;
        bands=smoothstep(.4,.95,bands);
        vec3 base=vec3(.043,.039,.035);
        vec3 hot=vec3(1.,.29,.17);
        vec3 bone=vec3(.93,.9,.86);
        float glow=smoothstep(.5,1.0,f);
        vec3 col=base+hot*glow*.6*uIntro*(1.-uScroll*.85)+bone*bands*.05*uIntro;
        col*=1.-smoothstep(.35,1.15,length(p))*.55;
        col+=(hash(vUv*uRes+uTime)-.5)*.035;
        gl_FragColor=vec4(col,1.);
      }`});
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),mat));
  const mouse=new THREE.Vector2(.5,.5);
  addEventListener('pointermove',e=>{mouse.set(e.clientX/innerWidth,1-e.clientY/innerHeight);});
  const resize=()=>{const w=canvas.clientWidth||innerWidth,h=canvas.clientHeight||innerHeight;renderer.setSize(w,h,false);
    uniforms.uRes.value.set(w*renderer.getPixelRatio(),h*renderer.getPixelRatio());};
  resize(); addEventListener('resize',resize);
  let active=true;
  const render=(time)=>{ if(!active) return;
    uniforms.uTime.value=time;
    uniforms.uMouse.value.lerp(mouse,.06);
    renderer.render(scene,cam); };
  if(!reduce) gsap.ticker.add(render); else { uniforms.uTime.value=3; renderer.render(scene,cam); }
  return {uniforms,setActive:v=>{active=v;}};
}

/* =====================================================================
   Nav / menu / anchors / FAQ
   ===================================================================== */
function toggleMenu(open){
  const m=$('#menu'), b=$('#menuBtn'); const isOpen=open??m.style.visibility!=='visible';
  b.setAttribute('aria-expanded',isOpen); b.textContent=isOpen?'Close':'Menu';
  if(isOpen){lenis&&lenis.stop();gsap.set(m,{visibility:'visible'});gsap.to(m,{clipPath:'inset(0 0 0% 0)',duration:.9,ease:'offbeat'});}
  else{lenis&&lenis.start();gsap.to(m,{clipPath:'inset(0 0 100% 0)',duration:.7,ease:'offbeat',onComplete:()=>gsap.set(m,{visibility:'hidden'})});}
}
function initNav(){
  $('#menuBtn').addEventListener('click',()=>toggleMenu());
  document.addEventListener('click',e=>{
    const a=e.target.closest('a[data-scroll],.m-link'); if(!a) return;
    const id=a.getAttribute('href'); if(!id||id[0]!=='#') return;
    e.preventDefault(); if($('#menu').style.visibility==='visible') toggleMenu(false);
    scrollTo(id==='#top'?0:id);
  });
  let hidden=false;
  ScrollTrigger.create({start:0,end:'max',onUpdate:self=>{
    const shouldHide=self.direction===1&&self.scroll()>300;
    if(shouldHide!==hidden){hidden=shouldHide;gsap.to('.nav',{yPercent:hidden?-110:0,duration:.7,ease:'offbeat',overwrite:true});}
  }});
  // FAQ accordion
  $$('.faq-item').forEach(item=>{
    const q=$('.faq-q',item), a=$('.faq-a',item);
    q.addEventListener('click',()=>{
      const open=!item.classList.contains('open');
      $$('.faq-item.open').forEach(o=>{if(o!==item){o.classList.remove('open');$('.faq-q',o).setAttribute('aria-expanded','false');gsap.to($('.faq-a',o),{height:0,duration:.6,ease:'offbeat'});}});
      item.classList.toggle('open',open); q.setAttribute('aria-expanded',open);
      gsap.to(a,{height:open?'auto':0,duration:.7,ease:'offbeat',onComplete:()=>ScrollTrigger.refresh()});
    });
  });
}

/* =====================================================================
   Counters (static fallback for reduced motion)
   ===================================================================== */
function initCounters(animate){
  $$('[data-count]').forEach(el=>{
    const end=+el.dataset.count, pre=el.dataset.prefix||'', suf=el.dataset.suffix||'', o={v:animate?0:end};
    const render=()=>{el.textContent=pre+new Intl.NumberFormat('en-IN').format(Math.round(o.v))+suf;};
    render();
    if(animate) gsap.to(o,{v:end,duration:2.4,ease:'power3.out',onUpdate:render,scrollTrigger:{trigger:el,start:'top 88%',once:true}});
  });
}

/* =====================================================================
   Preloader + hero intro
   ===================================================================== */
function runPreloader(){
  return new Promise(resolve=>{
    const num=$('.pre-num'), o={v:0};
    const tl=gsap.timeline();
    tl.from('#preWord span',{yPercent:110,duration:1.1,stagger:.06,ease:'offbeat'},0)
      .to(o,{v:100,duration:2.1,ease:'power2.inOut',onUpdate:()=>{num.textContent=String(Math.round(o.v)).padStart(3,'0');}},0)
      .to('.pre-bar i',{scaleX:1,duration:2.1,ease:'power2.inOut'},0)
      .to('#preWord span',{yPercent:-110,duration:.8,stagger:.04,ease:'power3.in'},2.3)
      .call(resolve,null,3.0)
      .to('.pre',{yPercent:-100,duration:1.1,ease:'offbeat'},2.9)
      .set('.pre',{display:'none'});
  });
}

let heroSplit, subSplit;
function prepareHero(){
  heroSplit=SplitText.create('.ht',{type:'chars'});
  gsap.set(heroSplit.chars,{yPercent:112});
  subSplit=SplitText.create('[data-hero-sub]',{type:'lines',mask:'lines'});
  gsap.set(subSplit.lines,{yPercent:112});
  gsap.set(['.hero-top','.hero-cta','.hero-foot'],{opacity:0});
  gsap.set('.badge',{opacity:0,scale:.4});
  gsap.set('.nav',{yPercent:-110});
}
function playHeroIntro(gl){
  const tl=gsap.timeline({defaults:{ease:'offbeat'}});
  tl.to(heroSplit.chars,{yPercent:0,duration:1.5,stagger:.05},0)
    .to(subSplit.lines,{yPercent:0,duration:1.3,stagger:.1},.3)
    .to(['.hero-top','.hero-cta','.hero-foot'],{opacity:1,duration:1.1,stagger:.12},.6)
    .to('.badge',{opacity:1,scale:1,duration:1.3},.8)
    .to('.nav',{yPercent:0,duration:1.1},.5);
  if(gl) tl.to(gl.uniforms.uIntro,{value:1,duration:2.6,ease:'power2.out'},0);
}

/* =====================================================================
   Scroll animations
   ===================================================================== */
function initScroll(gl){
  // Generic text reveals (masked lines)
  $$('[data-split]').forEach(el=>{
    const sp=SplitText.create(el,{type:'lines',mask:'lines'});
    gsap.set(sp.lines,{yPercent:112});
    ScrollTrigger.create({trigger:el,start:'top 86%',once:true,onEnter:()=>gsap.to(sp.lines,{yPercent:0,duration:1.2,ease:'offbeat',stagger:.09})});
  });
  // Generic fade-ups
  gsap.set('[data-reveal]',{opacity:0,y:50});
  ScrollTrigger.batch('[data-reveal]',{start:'top 92%',once:true,onEnter:els=>gsap.to(els,{opacity:1,y:0,duration:1.1,ease:'offbeat',stagger:.12})});
  // City meters
  $$('.meter').forEach(m=>gsap.to($('i',m),{scaleX:+m.dataset.fill,duration:1.6,ease:'offbeat',scrollTrigger:{trigger:m,start:'top 92%',once:true}}));

  // Hero parallax out
  gsap.to('.hero-in',{yPercent:-12,opacity:0,ease:'none',scrollTrigger:{trigger:'.hero',start:'top top',end:'bottom top',scrub:true}});
  gsap.to('#gl',{yPercent:18,ease:'none',scrollTrigger:{trigger:'.hero',start:'top top',end:'bottom top',scrub:true}});
  ScrollTrigger.create({trigger:'.hero',start:'top top',end:'bottom top',
    onUpdate:self=>{ if(gl) gl.uniforms.uScroll.value=self.progress; },
    onToggle:self=>{ if(gl) gl.setActive(self.isActive); }});

  // Marquee + badge reacting to scroll velocity
  const mqTween=gsap.to('.mq-track',{xPercent:-50,duration:30,ease:'none',repeat:-1});
  const spin=gsap.to('.badge svg',{rotation:360,duration:16,ease:'none',repeat:-1,transformOrigin:'50% 50%'});
  if(lenis){
    let t;
    lenis.on('scroll',({velocity})=>{
      const v=Math.min(Math.abs(velocity),30), dir=velocity<0?-1:1;
      gsap.to([mqTween,spin],{timeScale:dir*(1+v*.4),duration:.3,overwrite:true});
      clearTimeout(t); t=setTimeout(()=>gsap.to([mqTween,spin],{timeScale:1,duration:1.4,overwrite:true}),120);
    });
  }

  // Manifesto: scrubbed word reveal
  const ms=SplitText.create('[data-scrub]',{type:'words'});
  gsap.set(ms.words,{opacity:.12});
  gsap.to(ms.words,{opacity:1,stagger:.1,ease:'none',scrollTrigger:{trigger:'.manifesto-text',start:'top 80%',end:'bottom 55%',scrub:true}});
  $$('[data-speed]').forEach(el=>gsap.to(el,{yPercent:parseFloat(el.dataset.speed)*100,ease:'none',scrollTrigger:{trigger:el.parentElement,start:'top bottom',end:'bottom top',scrub:true}}));

  // Prize: colour block expands, number scales, counters
  gsap.fromTo('.prize-bg',{clipPath:'inset(10% 6% 10% 6% round 44px)'},{clipPath:'inset(0% 0% 0% 0% round 0px)',ease:'none',scrollTrigger:{trigger:'.prize',start:'top bottom',end:'top 15%',scrub:true}});
  gsap.fromTo('.prize-num',{scale:.62},{scale:1,ease:'none',scrollTrigger:{trigger:'.prize',start:'top 80%',end:'top 20%',scrub:true}});
  initCounters(true);

  // Categories: pinned horizontal scroll on desktop, stacked on mobile
  const mm=gsap.matchMedia();
  mm.add('(min-width: 900px)',()=>{
    const track=$('#track'), pin=$('#stylesPin');
    const dist=()=>Math.max(0,track.scrollWidth-innerWidth);
    gsap.to(track,{x:()=>-dist(),ease:'none',scrollTrigger:{
      trigger:'#styles',pin:pin,start:'top top',end:()=>'+='+dist(),scrub:1,invalidateOnRefresh:true,anticipatePin:1,
      onUpdate:self=>gsap.set('.h-prog i',{scaleX:self.progress})}});
    gsap.set(pin,{minHeight:'100vh'});
  });
  mm.add('(max-width: 899px)',()=>{
    $$('.card').forEach(c=>{gsap.set(c,{opacity:0,y:50});ScrollTrigger.create({trigger:c,start:'top 90%',once:true,onEnter:()=>gsap.to(c,{opacity:1,y:0,duration:1,ease:'offbeat'})});});
  });

  // Process timeline
  gsap.fromTo('.tl-fill',{scaleY:0},{scaleY:1,ease:'none',scrollTrigger:{trigger:'#tl',start:'top 62%',end:'bottom 62%',scrub:true}});
  $$('.tl-item').forEach(it=>ScrollTrigger.create({trigger:it,start:'top 64%',onEnter:()=>it.classList.add('on'),onLeaveBack:()=>it.classList.remove('on')}));

  // Judges: floating portrait tile that follows the cursor
  gsap.set('.j-list .j-row',{opacity:0,y:40});
  ScrollTrigger.batch('.j-row',{start:'top 92%',once:true,onEnter:els=>gsap.to(els,{opacity:1,y:0,duration:1,ease:'offbeat',stagger:.1})});
  if(!coarse){
    const tile=$('#jTile'), lab=$('span',tile);
    gsap.set(tile,{xPercent:-50,yPercent:-50,scale:.6,rotation:-6});
    const tx=gsap.quickTo(tile,'x',{duration:.6,ease:'power3'}), ty=gsap.quickTo(tile,'y',{duration:.6,ease:'power3'});
    let pointerX=0,pointerY=0,activeRow=null;
    const section=$('#judges');
    const hideTile=()=>gsap.to(tile,{opacity:0,scale:.6,rotation:-6,duration:.5,ease:'power3.out'});
    addEventListener('pointermove',e=>{pointerX=e.clientX;pointerY=e.clientY;tx(pointerX+40);ty(pointerY);});
    addEventListener('scroll',()=>{
      const rect=section.getBoundingClientRect();
      if(pointerX<rect.left||pointerX>rect.right||pointerY<rect.top||pointerY>rect.bottom){
        activeRow=null;
        hideTile();
      }
    },{passive:true});
    section.addEventListener('pointerleave',()=>{activeRow=null;hideTile();});
    $$('.j-row').forEach(row=>{
      row.addEventListener('pointerenter',()=>{activeRow=row;const j=JUDGES[+row.dataset.i];tile.style.background=`linear-gradient(155deg,${j.c1},${j.c2})`;lab.textContent=j.r;
        gsap.to(tile,{opacity:1,scale:1,rotation:0,duration:.7,ease:'offbeat'});});
      row.addEventListener('pointerleave',()=>{if(activeRow===row){activeRow=null;hideTile();}});
    });
  }

  // Footer wordmark
  const fb=SplitText.create('#footBig',{type:'chars'});
  gsap.set(fb.chars,{yPercent:110});
  ScrollTrigger.create({trigger:'#footBig',start:'top 95%',once:true,onEnter:()=>gsap.to(fb.chars,{yPercent:0,duration:1.4,ease:'offbeat',stagger:.06})});
}

/* =====================================================================
   Boot
   ===================================================================== */

async function boot(){
  await Promise.race([document.fonts.ready,sleep(2500)]);
  buildStatic(); initNav(); initCursor(); initMagnetic();
  const gl=initShader();
  if(reduce){
    $('.pre').remove(); initCounters(false);
    return;
  }
  prepareHero(); initScroll(gl);
  await runPreloader();
  playHeroIntro(gl);
  lenis&&lenis.start();
  ScrollTrigger.refresh();
  addEventListener('load',()=>ScrollTrigger.refresh());
}
boot();
})();
