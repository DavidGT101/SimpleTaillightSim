(() => {
  const CFG={
    COUNT:60,RAF_MS:16,SEQ_PAUSE:100,
    WELCOME_DELAY:200,GOODBYE_DELAY:200,RETURN_TO_RED_DELAY:200,
    AUDI_HOLD_ON:200,AUDI_FADE:80,AUDI_HOLD_OFF:250,
    BMW_FADE_IN:450,BMW_HOLD_OFF:225,
    MAZDA_HOLD_ON:150,MAZDA_FADE:300,MAZDA_HOLD_OFF:350,
    HAZ_ON:150,HAZ_OFF:150,
    BLINK_ON:350, BLINK_OFF:350, // Timing for Normal/USDM/Halogen
    REVERSE_HOLD_MS:250 // Hold duration for reverse toggle
  };
  const $=(q,el=document)=>el.querySelector(q);
  const bar=$('#bar'),modeName=$('#modeName'),panel=$('#panel');
  const icoL=$('#ico-left'),icoR=$('#ico-right'),icoH=$('#ico-haz');
  const testsBox=$('#tests'),testList=$('#testList');
  const statusBrake=$('#statusBrake'),statusReverse=$('#statusReverse');
  const segCountInput=$('#segCount'),segCountDisplay=$('#segCountDisplay');
  
  // Dynamic segment management
  let segs=[],left=[],right=[],mid=0;
  const state={modeIdx:0,on:false,signal:'none',animToken:0,iconToken:0,sysBusy:false,brakeActive:false,reverseActive:false};
  
  // Cache button references
  const btnCache={lock:null,left:null,hazard:null,right:null,brake:null,reverse:null,mode:null};
  
  // Track pending restore timeout to prevent interference between signals
  let restoreTimeout=null;
  
  // Generate segments dynamically
  function generateSegments(count){
    bar.innerHTML='';
    segs=[];
    for(let i=0;i<count;i++){
      const d=document.createElement('div');
      d.className='seg';
      d.dataset.i=i;
      bar.appendChild(d);
      segs.push(d);
    }
    CFG.COUNT=count;
    mid=CFG.COUNT/2|0;
    const q=mid/2|0;
    left=segs.slice(0,mid-q).reverse();
    right=segs.slice(mid+q);
    if(state.on)segs.forEach(s=>s.classList.add('on'));
    updateReverseLights();
  }
  
  // Initialize with default segments
  generateSegments(CFG.COUNT);
  
  const MODES=['Audi','BMW','Mazda','Normal','USDM','Halogen'];
  
  const setModeLabel=()=>modeName.textContent=MODES[state.modeIdx].toUpperCase();
  function clearSigIcons(){icoL.className='ico';icoR.className='ico';icoH.className='ico hazard'}
  function clsAll(keepRed){if(restoreTimeout){clearTimeout(restoreTimeout);restoreTimeout=null}segs.forEach(s=>{s.className='seg';s.style.transitionDuration='';if(keepRed)s.classList.add('on')});clearSigIcons();updateReverseLights()}
  function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
  const tick=()=>sleep(CFG.RAF_MS);
  const active=(token,dir)=>state.animToken===token&&state.signal===dir;
  function iconsApply(icons,cls,add,token){if(token!==state.iconToken)return;icons.forEach(ic=>ic.classList[add?'add':'remove'](cls))}
  
  // Brake light functions
  function activateBrake(){
    if(state.brakeActive)return;
    state.brakeActive=true;
    segs.forEach(s=>s.classList.add('brake'));
    statusBrake.classList.add('active','brake');
    if(btnCache.brake)btnCache.brake.classList.add('brake-active');
  }
  
  function deactivateBrake(){
    if(!state.brakeActive)return;
    state.brakeActive=false;
    segs.forEach(s=>s.classList.remove('brake'));
    statusBrake.classList.remove('active','brake');
    if(btnCache.brake)btnCache.brake.classList.remove('brake-active');
  }
  
  // Reverse light functions
  function updateReverseLights(){
    if(!state.reverseActive)return;
    const centerStart=Math.floor(CFG.COUNT*0.4);
    const centerEnd=Math.floor(CFG.COUNT*0.6);
    for(let i=centerStart;i<centerEnd;i++)segs[i]?.classList.add('reverse');
  }
  
  function toggleReverse(){
    state.reverseActive=!state.reverseActive;
    if(state.reverseActive){
      updateReverseLights();
      statusReverse.classList.add('active','reverse');
      if(btnCache.reverse)btnCache.reverse.classList.add('reverse-active');
    }else{
      for(let i=0;i<segs.length;i++)segs[i].classList.remove('reverse');
      statusReverse.classList.remove('active','reverse');
      if(btnCache.reverse)btnCache.reverse.classList.remove('reverse-active');
    }
  }
  
  async function systemSequence(kind){state.sysBusy=true;clsAll(kind==='goodbye');const half=mid;for(let i=0;i<half;i++){segs[i]?.classList.add('dim');segs[CFG.COUNT-1-i]?.classList.add('dim');await tick()}await sleep(CFG.SEQ_PAUSE);if(kind==='welcome'){for(let i=0;i<half;i++){segs[mid-1-i]?.classList.replace('dim','on');segs[mid+i]?.classList.replace('dim','on');await tick()}}else{for(let i=0;i<half;i++){segs[mid-1-i]?.classList.replace('on','dim');segs[mid+i]?.classList.replace('on','dim');await tick()}await sleep(CFG.SEQ_PAUSE);for(let i=0;i<half;i++){segs[i]?.classList.remove('dim');segs[CFG.COUNT-1-i]?.classList.remove('dim');await tick()}}state.sysBusy=false;updateReverseLights()}
  async function hazardFlash(cycles,keepBase){state.sysBusy=true;const all=[...left,...right];if(!keepBase)all.forEach(s=>s.classList.remove('on'));for(let c=0;c<cycles;c++){all.forEach(s=>s.classList.add('ind'));const itok=state.iconToken;iconsApply([icoL,icoR,icoH],'on',true,itok);await sleep(CFG.HAZ_ON);all.forEach(s=>s.classList.remove('ind'));iconsApply([icoL,icoR,icoH],'on',false,itok);await sleep(CFG.HAZ_OFF)}state.sysBusy=false;updateReverseLights()}
  function restoreRedDelayed(group){if(!state.on)return;if(restoreTimeout)clearTimeout(restoreTimeout);restoreTimeout=setTimeout(()=>{restoreTimeout=null;group.forEach(s=>{s.classList.add('on');s.style.transitionDuration='.4s'});setTimeout(()=>{group.forEach(s=>s.style.transitionDuration='');updateReverseLights()},420)},CFG.RETURN_TO_RED_DELAY)}
  function normalizeArr(v){return Array.isArray(v)?v:[]}

  function runAudi(primary=[],mirror=[],dir,token){primary=normalizeArr(primary);mirror=normalizeArr(mirror);const all=[...primary,...mirror];const sigIcos=dir==='hazard'?[icoL,icoR,icoH]:dir==='left'?[icoL]:[icoR];const itok=state.iconToken;(async()=>{while(active(token,dir)){await sleep(CFG.AUDI_HOLD_OFF);if(!active(token,dir))break;iconsApply(sigIcos,'on',true,itok);for(let i=0;i<primary.length;i++){if(!active(token,dir))break;primary[i]?.classList.add('ind');if(mirror[i])mirror[i].classList.add('ind');await tick()}if(!active(token,dir))break;await sleep(CFG.AUDI_HOLD_ON);if(!active(token,dir))break;all.forEach(s=>s.classList.replace('ind','ind-dim'));iconsApply(sigIcos,'on',false,itok);await sleep(CFG.AUDI_FADE);all.forEach(s=>s.classList.remove('ind-dim'))}all.forEach(s=>s.className='seg');clearSigIcons();restoreRedDelayed(all)})()}
  
  function runBMW(primary=[],mirror=[],dir,token){primary=normalizeArr(primary);mirror=normalizeArr(mirror);const all=[...primary,...mirror];const sigIcos=dir==='hazard'?[icoL,icoR,icoH]:dir==='left'?[icoL]:[icoR];const itok=state.iconToken;(async()=>{while(active(token,dir)){await sleep(CFG.BMW_HOLD_OFF);if(!active(token,dir))break;all.forEach(s=>{s.style.transitionDuration='.35s';s.classList.add('ind')});iconsApply(sigIcos,'on',true,itok);await sleep(CFG.BMW_FADE_IN);all.forEach(s=>{s.style.transitionDuration='0s';s.classList.remove('ind');s.offsetHeight;s.style.transitionDuration=''});iconsApply(sigIcos,'on',false,itok)}all.forEach(s=>s.className='seg');clearSigIcons();restoreRedDelayed(all)})()}
  
  function runMazda(primary=[],mirror=[],dir,token){primary=normalizeArr(primary);mirror=normalizeArr(mirror);const all=[...primary,...mirror];const sigIcos=dir==='hazard'?[icoL,icoR,icoH]:dir==='left'?[icoL]:[icoR];const itok=state.iconToken;(async()=>{while(active(token,dir)){await sleep(CFG.MAZDA_HOLD_OFF);if(!active(token,dir))break;all.forEach(s=>{s.style.transitionDuration='0s';s.classList.add('ind');s.offsetHeight;s.style.transitionDuration='.3s'});iconsApply(sigIcos,'on',true,itok);await sleep(CFG.MAZDA_HOLD_ON);if(!active(token,dir))break;all.forEach(s=>s.classList.replace('ind','ind-dim'));iconsApply(sigIcos,'dim',true,itok);await sleep(CFG.MAZDA_FADE);all.forEach(s=>{s.classList.remove('ind-dim');s.style.transitionDuration='' });iconsApply(sigIcos,'dim',false,itok);iconsApply(sigIcos,'on',false,itok)}all.forEach(s=>s.className='seg');clearSigIcons();restoreRedDelayed(all)})()}

  function runSimpleBlink(primary=[],mirror=[],dir,token,type){
    primary=normalizeArr(primary); mirror=normalizeArr(mirror);
    const all=[...primary,...mirror];
    const sigIcos=dir==='hazard'?[icoL,icoR,icoH]:dir==='left'?[icoL]:[icoR];
    const itok=state.iconToken;
    const activeClass = type === 'USDM' ? 'usdm' : 'ind';
    all.forEach(s => s.style.transition = 'none');
    (async()=>{
        while(active(token,dir)){
            all.forEach(s => s.classList.remove(activeClass));
            iconsApply(sigIcos,'on',false,itok);
            await sleep(CFG.BLINK_OFF);
            if(!active(token,dir)) break;
            all.forEach(s => s.classList.add(activeClass));
            iconsApply(sigIcos,'on',true,itok);
            await sleep(CFG.BLINK_ON);
        }
        all.forEach(s=>{s.className='seg'; s.style.transition = ''}); 
        clearSigIcons();
        restoreRedDelayed(all);
    })()
  }

  function runHalogen(primary=[],mirror=[],dir,token){
    primary=normalizeArr(primary); mirror=normalizeArr(mirror);
    const all=[...primary,...mirror];
    const sigIcos=dir==='hazard'?[icoL,icoR,icoH]:dir==='left'?[icoL]:[icoR];
    const itok=state.iconToken;
    (async()=>{
        while(active(token,dir)){
            all.forEach(s => {
                s.style.transitionDuration = '0.35s';
                s.style.transitionTimingFunction = 'ease-in';
                s.classList.remove('ind');
            });
            iconsApply(sigIcos,'on',false,itok);
            await sleep(CFG.BLINK_OFF);
            if(!active(token,dir)) break;
            all.forEach(s => {
                s.style.transitionDuration = '0.12s';
                s.style.transitionTimingFunction = 'ease-out';
                s.classList.add('ind');
            });
            iconsApply(sigIcos,'on',true,itok);
            await sleep(CFG.BLINK_ON);
        }
      all.forEach(s=>{s.className='seg'; s.style.transitionDuration='';});
      clearSigIcons();
      restoreRedDelayed(all);
    })()
    }

  function activate(dir){
      if(state.sysBusy)return;
      if(state.signal===dir){
          state.signal='none';state.animToken++;state.iconToken++;if(restoreTimeout){clearTimeout(restoreTimeout);restoreTimeout=null}clearSigIcons();return
      }
      clsAll(state.on);
      state.signal=dir;
      const token=++state.animToken;++state.iconToken;
      const groups=dir==='hazard'?[left,right]:(dir==='left'?[left,[]]:[right,[]]);
      groups.forEach(g=>g.forEach(s=>s.classList.remove('on')));
      
      const mode=MODES[state.modeIdx];
      
      if(mode==='Audi') runAudi(...groups,dir,token);
      else if(mode==='BMW') runBMW(...groups,dir,token);
      else if(mode==='Mazda') runMazda(...groups,dir,token);
      else if(mode==='Normal') runSimpleBlink(...groups,dir,token, 'Normal');
      else if(mode==='USDM') runSimpleBlink(...groups,dir,token, 'USDM');
      else if(mode==='Halogen') runHalogen(...groups,dir,token);
  }

  async function lockUnlock(){if(state.sysBusy)return;if(restoreTimeout){clearTimeout(restoreTimeout);restoreTimeout=null}if(!state.on){state.on=true;await hazardFlash(2,false);await sleep(CFG.WELCOME_DELAY);await systemSequence('welcome')}else{state.on=false;await hazardFlash(1,true);await sleep(CFG.GOODBYE_DELAY);await systemSequence('goodbye')}}
  function changeMode(){clsAll(state.on);state.modeIdx=(state.modeIdx+1)%MODES.length;setModeLabel()}
  function toggleUI(){panel.style.display=panel.style.display==='none'?'':'none'}
  
  // Segment count control
  segCountInput.addEventListener('input',e=>{
    const count=parseInt(e.target.value);
    segCountDisplay.textContent=count;
    generateSegments(count);
  });
  
  // Keyboard controls
  const down=new Set();let tHoldTimer=null,qHoldTimer=null;
  document.addEventListener('keydown',e=>{
    const k=e.key.toLowerCase();
    if(down.has(k))return;
    down.add(k);
    
    if(k==='f')lockUnlock();
    else if(k==='z')activate('left');
    else if(k==='c')activate('right');
    else if(k==='x')activate('hazard');
    else if(k==='m')changeMode();
    else if(k==='h')toggleUI();
    else if(k==='s')activateBrake();
    else if(k==='q'){
      if(qHoldTimer)clearTimeout(qHoldTimer);
      qHoldTimer=setTimeout(()=>toggleReverse(),CFG.REVERSE_HOLD_MS);
    }
    else if(k==='t'){
      if(tHoldTimer)clearTimeout(tHoldTimer);
      tHoldTimer=setTimeout(()=>{
        if(testsBox)testsBox.style.display='block';
        runSelfTests().then(()=>{
          const failed=testsBox.querySelectorAll('.fail').length;
          if(failed===0){setTimeout(()=>location.reload(),800)}
        })
      },500)
    }
  });
  
  document.addEventListener('keyup',e=>{
    const k=e.key.toLowerCase();
    down.delete(k);
    if(k==='s')deactivateBrake();
    else if(k==='q'){
      if(qHoldTimer){clearTimeout(qHoldTimer);qHoldTimer=null}
    }
    else if(k==='t'){
      if(tHoldTimer){clearTimeout(tHoldTimer);tHoldTimer=null}
    }
  });
  
  window.addEventListener('blur',()=>{down.clear();deactivateBrake()});
  
  // Touch/Mobile Controls
  const setupTouchControls=()=>{
    btnCache.lock=$('#btnLock');
    btnCache.left=$('#btnLeft');
    btnCache.hazard=$('#btnHazard');
    btnCache.right=$('#btnRight');
    btnCache.brake=$('#btnBrake');
    btnCache.reverse=$('#btnReverse');
    btnCache.mode=$('#btnMode');
    
    if(btnCache.lock)btnCache.lock.addEventListener('click',()=>lockUnlock());
    if(btnCache.left)btnCache.left.addEventListener('click',()=>activate('left'));
    if(btnCache.hazard)btnCache.hazard.addEventListener('click',()=>activate('hazard'));
    if(btnCache.right)btnCache.right.addEventListener('click',()=>activate('right'));
    if(btnCache.mode)btnCache.mode.addEventListener('click',()=>changeMode());
    
    if(btnCache.brake){
      btnCache.brake.addEventListener('touchstart',e=>{e.preventDefault();activateBrake()});
      btnCache.brake.addEventListener('touchend',e=>{e.preventDefault();deactivateBrake()});
      btnCache.brake.addEventListener('mousedown',()=>activateBrake());
      btnCache.brake.addEventListener('mouseup',()=>deactivateBrake());
      btnCache.brake.addEventListener('mouseleave',()=>deactivateBrake());
    }
    
    if(btnCache.reverse){
      let reverseTimer=null;
      btnCache.reverse.addEventListener('touchstart',e=>{
        e.preventDefault();
        reverseTimer=setTimeout(()=>toggleReverse(),CFG.REVERSE_HOLD_MS);
      });
      btnCache.reverse.addEventListener('touchend',e=>{
        e.preventDefault();
        if(reverseTimer){clearTimeout(reverseTimer);reverseTimer=null}
      });
      btnCache.reverse.addEventListener('mousedown',()=>{
        reverseTimer=setTimeout(()=>toggleReverse(),CFG.REVERSE_HOLD_MS);
      });
      btnCache.reverse.addEventListener('mouseup',()=>{
        if(reverseTimer){clearTimeout(reverseTimer);reverseTimer=null}
      });
    }
  };
  
  // Self-tests
  function addResult(name,ok,err){const li=document.createElement('li');li.textContent=(ok?'PASS: ':'FAIL: ')+name+(ok?'':(err?' — '+(err.message?err.message:err):''));li.className=ok?'ok':'fail';testList.appendChild(li);testResults.push({name,ok,error:ok?null:(err&&err.message?err.message:String(err||''))})}
  function setSummary(total,passed,ms){const s=document.getElementById('testSummary');s.textContent=passed+'/'+total+' passed in '+Math.round(ms)+' ms'}
  function segClassCount(cls){let n=0;const len=segs.length;for(let i=0;i<len;i++)if(segs[i].classList.contains(cls))n++;return n}
  function iconsAreClear(){return icoL.className==='ico'&&icoR.className==='ico'&&icoH.className==='ico hazard'}
  const testResults=[];
  async function runSelfTests(){testResults.length=0;testList.textContent='';const t0=performance.now();
    try{activate('left');await sleep(220);activate('left');addResult('left toggle',true)}catch(e){addResult('left toggle',false,e)}
    try{activate('right');await sleep(220);activate('right');addResult('right toggle',true)}catch(e){addResult('right toggle',false,e)}
    try{activate('hazard');await sleep(260);activate('hazard');addResult('hazard toggle resets icons',iconsAreClear(),'icons not cleared')}catch(e){addResult('hazard toggle resets icons',false,e)}
    try{activate('left');await sleep(120);activate('left');addResult('left cancel clears all classes',segClassCount('ind')===0&&segClassCount('ind-dim')===0&&iconsAreClear(),'classes or icons linger')}catch(e){addResult('left cancel clears all classes',false,e)}
    try{activate('right');await sleep(120);activate('hazard');await sleep(220);activate('hazard');addResult('right→hazard→off leaves icons clear',iconsAreClear(),'icons linger after hazard off')}catch(e){addResult('right→hazard→off leaves icons clear',false,e)}
    try{const before=state.modeIdx;activate('left');await sleep(100);changeMode();await sleep(200);activate('left');await sleep(150);activate('left');addResult('mode change during signal is stable',segClassCount('ind')===0&&segClassCount('ind-dim')===0&&iconsAreClear()&&state.modeIdx!==before,'residue after mode change')}catch(e){addResult('mode change during signal is stable',false,e)}
    try{clsAll(false);addResult('locked default has no lit segments',segClassCount('on')===0,'some segments lit on load')}catch(e){addResult('locked default has no lit segments',false,e)}
    const total=testResults.length,passed=testResults.filter(t=>t.ok).length;setSummary(total,passed,performance.now()-t0)}
  
  setModeLabel();
  setupTouchControls();
})();
