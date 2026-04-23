(() => {
  const CFG={
    COUNT:60,RAF_MS:16,SEQ_PAUSE:100,
    WELCOME_DELAY:200,GOODBYE_DELAY:200,RETURN_TO_RED_DELAY:200,
    AUDI_HOLD_ON:200,AUDI_FADE:80,AUDI_HOLD_OFF:250,
    BMW_FADE_IN:450,BMW_HOLD_OFF:225,
    MAZDA_HOLD_ON:150,MAZDA_FADE:300,MAZDA_HOLD_OFF:350,
    HAZ_ON:150,HAZ_OFF:150,
    BLINK_ON:350, BLINK_OFF:350, // Timing for Normal/USDM/Halogen
    USDM_HOLD_ON_MS:280,
    USDM_HOLD_OFF_MS:180,
    USDM_SEQ_SWEEP_MS:300,
    USDM_FADE_MS:140,
    BRAKE_FLASH_DELAY_MS:500, // Keep brake solid for first 500ms, then flash
    BRAKE_FLASH_ON_MS:90,
    BRAKE_FLASH_OFF_MS:90,
    PRESENCE_PING_MS:10000,
    REVERSE_HOLD_MS:250, // Hold duration for reverse toggle
    REVERSE_TEST_TAP_COUNT:5, // Quick taps on Reverse to trigger tests on mobile
    REVERSE_TEST_WINDOW_MS:2200, // Time window to collect reverse taps for test trigger
    TEST_RELOAD_DELAY_MS:2000, // Pause after all tests pass before page reload
    HAPTIC_TAP_MS:18,
    HAPTIC_FLASH_MS:26,
    HAPTIC_SIGNAL_ON_MS:18,
    HAPTIC_BRAKE_ON_MS:20
  };
  const $=(q,el=document)=>el.querySelector(q);
  const bar=$('#bar'),barShell=$('.bar-shell'),modeName=$('#modeName'),panel=$('#panel');
  const testsBox=$('#tests'),testList=$('#testList'),testSummary=$('#testSummary');
  const statusBrake=$('#statusBrake'),statusReverse=$('#statusReverse');
  const segCountInput=$('#segCount'),segCountDisplay=$('#segCountDisplay');
  const MOBILE_DEFAULT_SEGMENTS=20;
  const PROFILE_CLASSES=['profile-mobile','profile-desktop'];
  const PRESENCE_HEARTBEAT_PATH='/__control/heartbeat';
  const PRESENCE_DISCONNECT_PATH='/__control/disconnect';
  const PRESENCE_STORAGE_KEY='taillightsim-device-id';
  
  // Dynamic segment management
  let segs=[],left=[],right=[],mid=0;
  const state={modeIdx:0,on:false,signal:'none',animToken:0,iconToken:0,sysBusy:false,brakeActive:false,reverseActive:false};
  
  // Cache button references
  const btnCache={lock:null,left:null,hazard:null,right:null,brake:null,reverse:null,mode:null};
  
  // Track pending restore timeout to prevent interference between signals
  let restoreTimeout=null;
  let reverseTestTapCount=0;
  let reverseTestTapTimer=null;
  let selfTestsRunning=false;
  let brakeFlashDelayTimer=null;
  let brakeFlashCycleTimer=null;
  let brakeFlashVisible=false;
  let brakeActivatedAt=0;
  let presencePingTimer=null;
  const presenceDeviceId=(()=>{
    try{
      const stored=localStorage.getItem(PRESENCE_STORAGE_KEY);
      if(stored)return stored;
      const generated=`dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
      localStorage.setItem(PRESENCE_STORAGE_KEY,generated);
      return generated;
    }catch(_err){
      return `dev-${Date.now().toString(36)}-anon`;
    }
  })();

  function buildPresencePayload(){
    return JSON.stringify({
      deviceId:presenceDeviceId,
      pageVisible:document.visibilityState==='visible',
      page:'TaillightSim',
      mode:MODES[state.modeIdx],
      signal:state.signal,
      powerOn:state.on,
      ts:Date.now(),
    });
  }

  function postPresence(path,useBeacon=false){
    const payload=buildPresencePayload();
    if(useBeacon&&navigator.sendBeacon){
      try{
        const blob=new Blob([payload],{type:'application/json'});
        navigator.sendBeacon(path,blob);
        return;
      }catch(_err){
        // Fall through to fetch if beacon fails.
      }
    }
    fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:payload,keepalive:useBeacon,cache:'no-store'}).catch(()=>{});
  }

  function startPresenceReporting(){
    postPresence(PRESENCE_HEARTBEAT_PATH);
    if(presencePingTimer)clearInterval(presencePingTimer);
    presencePingTimer=setInterval(()=>postPresence(PRESENCE_HEARTBEAT_PATH),CFG.PRESENCE_PING_MS);
    document.addEventListener('visibilitychange',()=>postPresence(PRESENCE_HEARTBEAT_PATH));
    window.addEventListener('pagehide',()=>postPresence(PRESENCE_DISCONNECT_PATH,true));
    window.addEventListener('beforeunload',()=>postPresence(PRESENCE_DISCONNECT_PATH,true));
  }

  function setBrakeVisual(isOn){
    brakeFlashVisible=isOn;
    for(let i=0;i<segs.length;i++){
      segs[i].classList.toggle('brake',isOn);
      segs[i].classList.toggle('ebrake-off',!isOn);
    }
  }

  function clearBrakeVisual(){
    brakeFlashVisible=false;
    for(let i=0;i<segs.length;i++){
      segs[i].classList.remove('brake');
      segs[i].classList.remove('ebrake-off');
    }
  }

  function clearBrakeFlashTimers(){
    if(brakeFlashDelayTimer){
      clearTimeout(brakeFlashDelayTimer);
      brakeFlashDelayTimer=null;
    }
    if(brakeFlashCycleTimer){
      clearTimeout(brakeFlashCycleTimer);
      brakeFlashCycleTimer=null;
    }
  }

  function scheduleBrakeFlashPhase(nextOn,delayMs){
    brakeFlashCycleTimer=setTimeout(()=>{
      if(!state.brakeActive)return;
      if(nextOn)triggerHaptic(CFG.HAPTIC_BRAKE_ON_MS);
      setBrakeVisual(nextOn);
      const nextDelay=nextOn?CFG.BRAKE_FLASH_ON_MS:CFG.BRAKE_FLASH_OFF_MS;
      scheduleBrakeFlashPhase(!nextOn,nextDelay);
    },delayMs);
  }

  function fitLightbarToShell(){
    if(!barShell||!bar)return;
    requestAnimationFrame(()=>{
      bar.style.transform='scale(1)';
      const shellWidth=barShell.clientWidth;
      const barWidth=bar.scrollWidth;
      if(!shellWidth||!barWidth)return;
      const glowAllowancePx=56;
      const availableWidth=Math.max(1,shellWidth-glowAllowancePx);
      const scale=Math.min(1,availableWidth/barWidth);
      bar.style.transform=`scale(${scale})`;
    });
  }
  
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
    if(state.brakeActive)setBrakeVisual(brakeFlashVisible);
    fitLightbarToShell();
  }
  
  function getProfileOverride(search=window.location.search){
    try{
      const profileRaw=new URLSearchParams(search).get('profile');
      if(!profileRaw)return null;
      const profile=profileRaw.trim().toLowerCase();
      if(profile==='mobile'||profile==='m')return 'mobile';
      if(profile==='desktop'||profile==='pc'||profile==='d')return 'desktop';
    }catch(_err){
      // Ignore malformed query strings and fall back to auto detection.
    }
    return null;
  }

  function applyProfileClass(profile){
    document.body.classList.remove(...PROFILE_CLASSES);
    if(profile==='mobile')document.body.classList.add('profile-mobile');
    else if(profile==='desktop')document.body.classList.add('profile-desktop');
  }

  function getInitialSegmentCount(options={}){
    const sliderCount=parseInt(options.sliderValue??(segCountInput?.value||''),10);
    const fallback=Number.isNaN(sliderCount)?CFG.COUNT:sliderCount;
    const profileOverride=options.profileOverride??getProfileOverride();
    if(profileOverride==='mobile')return MOBILE_DEFAULT_SEGMENTS;
    if(profileOverride==='desktop')return fallback;
    const ua=options.userAgent??(navigator.userAgent||'');
    const uaMobile=/android|iphone|ipad|ipod|mobile/i.test(ua);
    const narrowViewport=options.narrowViewport??window.matchMedia('(max-width: 768px)').matches;
    const coarsePointer=options.coarsePointer??window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    const isMobileView=uaMobile||narrowViewport||coarsePointer;
    return isMobileView?MOBILE_DEFAULT_SEGMENTS:fallback;
  }

  function isMobileInteractionProfile(options={}){
    const profileOverride=options.profileOverride??getProfileOverride();
    if(profileOverride==='mobile')return true;
    if(profileOverride==='desktop')return false;
    const ua=options.userAgent??(navigator.userAgent||'');
    const uaMobile=/android|iphone|ipad|ipod|mobile/i.test(ua);
    const narrowViewport=options.narrowViewport??window.matchMedia('(max-width: 768px)').matches;
    const coarsePointer=options.coarsePointer??window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    const hasTouch=options.hasTouch??('ontouchstart' in window||navigator.maxTouchPoints>0);
    return uaMobile||narrowViewport||coarsePointer||hasTouch;
  }

  // Initialize based on viewport context (mobile defaults to fewer segments)
  const activeProfileOverride=getProfileOverride();
  applyProfileClass(activeProfileOverride);
  const initialSegments=getInitialSegmentCount({profileOverride:activeProfileOverride});
  const canVibrate=typeof navigator.vibrate==='function';
  if(segCountInput)segCountInput.value=String(initialSegments);
  if(segCountDisplay)segCountDisplay.textContent=String(initialSegments);
  generateSegments(initialSegments);

  function triggerHaptic(pattern=CFG.HAPTIC_TAP_MS){
    if(!canVibrate)return false;
    try{
      return navigator.vibrate(pattern)!==false;
    }catch(_err){
      return false;
    }
  }

  function triggerLockUnlockFlashHaptics(cycles){
    if(cycles<=0)return;
    if(cycles===1){
      triggerHaptic(CFG.HAPTIC_FLASH_MS);
      return;
    }
    const pattern=[];
    const interFlashPause=Math.max(0,CFG.HAZ_ON+CFG.HAZ_OFF-CFG.HAPTIC_FLASH_MS);
    for(let i=0;i<cycles;i++){
      pattern.push(CFG.HAPTIC_FLASH_MS);
      if(i<cycles-1)pattern.push(interFlashPause);
    }
    triggerHaptic(pattern);
  }

  function triggerSignalOnHaptic(){
    triggerHaptic(CFG.HAPTIC_SIGNAL_ON_MS);
  }
  
  const MODES=['Audi','BMW','Mazda','Normal','USDM','Halogen'];
  
  const setModeLabel=()=>modeName.textContent=MODES[state.modeIdx].toUpperCase();
  function getSignalButtons(dir){
    if(dir==='hazard')return [btnCache.left,btnCache.right,btnCache.hazard].filter(Boolean);
    if(dir==='left')return [btnCache.left].filter(Boolean);
    if(dir==='right')return [btnCache.right].filter(Boolean);
    return [];
  }
  function clearSigIcons(){
    const buttons=getSignalButtons('hazard');
    buttons.forEach(btn=>btn.classList.remove('on','dim'));
  }
  function clsAll(keepRed){
    if(restoreTimeout){clearTimeout(restoreTimeout);restoreTimeout=null}
    segs.forEach(s=>{
      s.className='seg';
      s.style.transition='';
      s.style.transitionDuration='';
      s.style.transitionTimingFunction='';
      if(keepRed)s.classList.add('on')
    });
    clearSigIcons();
    updateReverseLights();
    if(state.brakeActive)setBrakeVisual(brakeFlashVisible)
  }
  function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
  const tick=()=>sleep(CFG.RAF_MS);
  const active=(token,dir)=>state.animToken===token&&state.signal===dir;
  function iconsApply(icons,cls,add,token){if(token!==state.iconToken)return;icons.forEach(ic=>ic&&ic.classList[add?'add':'remove'](cls))}
  
  // Emergency brake functions
  function activateBrake(){
    if(state.brakeActive)return;
    state.brakeActive=true;
    brakeActivatedAt=performance.now();
    clearBrakeFlashTimers();
    triggerHaptic(CFG.HAPTIC_BRAKE_ON_MS);
    setBrakeVisual(true);
    statusBrake.classList.add('active','brake');
    if(btnCache.brake)btnCache.brake.classList.add('brake-active');
    brakeFlashDelayTimer=setTimeout(()=>{
      brakeFlashDelayTimer=null;
      if(!state.brakeActive)return;
      setBrakeVisual(false);
      scheduleBrakeFlashPhase(true,CFG.BRAKE_FLASH_OFF_MS);
    },CFG.BRAKE_FLASH_DELAY_MS);
  }
  
  function deactivateBrake(){
    if(!state.brakeActive)return;
    state.brakeActive=false;
    brakeActivatedAt=0;
    clearBrakeFlashTimers();
    clearBrakeVisual();
    statusBrake.classList.remove('active','brake');
    if(btnCache.brake)btnCache.brake.classList.remove('brake-active');
  }

  function releaseBrakeToHazard(){
    const holdCompleted=state.brakeActive&&(performance.now()-brakeActivatedAt)>=CFG.BRAKE_FLASH_DELAY_MS;
    deactivateBrake();
    if(!holdCompleted||state.sysBusy)return;
    if(state.signal!=='hazard')activate('hazard');
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
  async function hazardFlash(cycles,keepBase,hapticOnFlash=false){state.sysBusy=true;const all=[...left,...right];const sigButtons=getSignalButtons('hazard');if(!keepBase)all.forEach(s=>s.classList.remove('on'));for(let c=0;c<cycles;c++){if(hapticOnFlash)triggerHaptic(CFG.HAPTIC_FLASH_MS);all.forEach(s=>s.classList.add('ind'));const itok=state.iconToken;iconsApply(sigButtons,'on',true,itok);await sleep(CFG.HAZ_ON);all.forEach(s=>s.classList.remove('ind'));iconsApply(sigButtons,'on',false,itok);await sleep(CFG.HAZ_OFF)}state.sysBusy=false;updateReverseLights()}
  function restoreRedDelayed(group){if(!state.on)return;if(restoreTimeout)clearTimeout(restoreTimeout);restoreTimeout=setTimeout(()=>{restoreTimeout=null;group.forEach(s=>{s.classList.add('on');s.style.transitionDuration='.4s'});setTimeout(()=>{group.forEach(s=>s.style.transitionDuration='');updateReverseLights()},420)},CFG.RETURN_TO_RED_DELAY)}
  function normalizeArr(v){return Array.isArray(v)?v:[]}

  function runAudi(primary=[],mirror=[],dir,token){
    primary=normalizeArr(primary);
    mirror=normalizeArr(mirror);
    const all=[...primary,...mirror];
    const sigIcos=getSignalButtons(dir);
    const itok=state.iconToken;
    (async()=>{
      while(active(token,dir)){
        await sleep(CFG.AUDI_HOLD_OFF);
        if(!active(token,dir))break;
        triggerSignalOnHaptic();
        iconsApply(sigIcos,'on',true,itok);
        for(let i=0;i<primary.length;i++){
          if(!active(token,dir))break;
          primary[i]?.classList.add('ind');
          if(mirror[i])mirror[i].classList.add('ind');
          await tick()
        }
        if(!active(token,dir))break;
        await sleep(CFG.AUDI_HOLD_ON);
        if(!active(token,dir))break;
        all.forEach(s=>s.classList.replace('ind','ind-dim'));
        iconsApply(sigIcos,'on',false,itok);
        await sleep(CFG.AUDI_FADE);
        if(!active(token,dir))break;
        all.forEach(s=>s.classList.remove('ind-dim'))
      }
      if(state.signal==='none'){
        all.forEach(s=>s.className='seg');
        clearSigIcons();
        restoreRedDelayed(all)
      }
    })()
  }
  
  function runBMW(primary=[],mirror=[],dir,token){
    primary=normalizeArr(primary);
    mirror=normalizeArr(mirror);
    const all=[...primary,...mirror];
    const sigIcos=getSignalButtons(dir);
    const itok=state.iconToken;
    (async()=>{
      while(active(token,dir)){
        await sleep(CFG.BMW_HOLD_OFF);
        if(!active(token,dir))break;
        triggerSignalOnHaptic();
        all.forEach(s=>{s.style.transitionDuration='.35s';s.classList.add('ind')});
        iconsApply(sigIcos,'on',true,itok);
        await sleep(CFG.BMW_FADE_IN);
        if(!active(token,dir))break;
        all.forEach(s=>{s.style.transitionDuration='0s';s.classList.remove('ind');s.offsetHeight;s.style.transitionDuration=''});
        iconsApply(sigIcos,'on',false,itok)
      }
      if(state.signal==='none'){
        all.forEach(s=>s.className='seg');
        clearSigIcons();
        restoreRedDelayed(all)
      }
    })()
  }
  
  function runMazda(primary=[],mirror=[],dir,token){
    primary=normalizeArr(primary);
    mirror=normalizeArr(mirror);
    const all=[...primary,...mirror];
    const sigIcos=getSignalButtons(dir);
    const itok=state.iconToken;
    (async()=>{
      while(active(token,dir)){
        await sleep(CFG.MAZDA_HOLD_OFF);
        if(!active(token,dir))break;
        triggerSignalOnHaptic();
        all.forEach(s=>{s.style.transitionDuration='0s';s.classList.add('ind');s.offsetHeight;s.style.transitionDuration='.3s'});
        iconsApply(sigIcos,'on',true,itok);
        await sleep(CFG.MAZDA_HOLD_ON);
        if(!active(token,dir))break;
        all.forEach(s=>s.classList.replace('ind','ind-dim'));
        iconsApply(sigIcos,'dim',true,itok);
        await sleep(CFG.MAZDA_FADE);
        if(!active(token,dir))break;
        all.forEach(s=>{s.classList.remove('ind-dim');s.style.transitionDuration=''});
        iconsApply(sigIcos,'dim',false,itok);
        iconsApply(sigIcos,'on',false,itok)
      }
      if(state.signal==='none'){
        all.forEach(s=>s.className='seg');
        clearSigIcons();
        restoreRedDelayed(all)
      }
    })()
  }

  function runSimpleBlink(primary=[],mirror=[],dir,token,type){
    primary=normalizeArr(primary); mirror=normalizeArr(mirror);
    const all=[...primary,...mirror];
    const sigIcos=getSignalButtons(dir);
    const itok=state.iconToken;
    const activeClass = type === 'USDM' ? 'usdm' : 'ind';
    all.forEach(s => s.style.transition = 'none');
    (async()=>{
        while(active(token,dir)){
            all.forEach(s => s.classList.remove(activeClass));
            iconsApply(sigIcos,'on',false,itok);
            await sleep(CFG.BLINK_OFF);
            if(!active(token,dir)) break;
            triggerSignalOnHaptic();
            all.forEach(s => s.classList.add(activeClass));
            iconsApply(sigIcos,'on',true,itok);
            await sleep(CFG.BLINK_ON);
        }
        if(state.signal==='none'){
          all.forEach(s=>{s.className='seg'; s.style.transition = ''});
          clearSigIcons();
          restoreRedDelayed(all);
        }
    })()
  }

  function runUSDMSequential(primary=[],mirror=[],dir,token){
    primary=normalizeArr(primary);
    mirror=normalizeArr(mirror);
    const all=[...primary,...mirror];
    const sigIcos=getSignalButtons(dir);
    const itok=state.iconToken;
    const seqLen=Math.max(1,Math.max(primary.length,mirror.length));
    const seqStepMs=Math.max(12,Math.min(60,Math.round(CFG.USDM_SEQ_SWEEP_MS/seqLen)));
    all.forEach(s=>{
      s.style.transitionDuration=`${CFG.USDM_FADE_MS}ms`;
      s.style.transitionTimingFunction='ease-in-out';
    });
    (async()=>{
      while(active(token,dir)){
        triggerSignalOnHaptic();
        all.forEach(s=>s.classList.add('usdm'));
        iconsApply(sigIcos,'on',true,itok);
        await sleep(CFG.USDM_HOLD_ON_MS);
        iconsApply(sigIcos,'on',false,itok);
        for(let i=0;i<seqLen;i++){
          if(!active(token,dir))break;
          if(primary[i])primary[i].classList.remove('usdm');
          if(mirror[i])mirror[i].classList.remove('usdm');
          await sleep(seqStepMs);
        }
        if(!active(token,dir))break;
        await sleep(CFG.USDM_HOLD_OFF_MS);
      }
      if(state.signal==='none'){
        all.forEach(s=>{
          s.className='seg';
          s.style.transition='';
          s.style.transitionDuration='';
          s.style.transitionTimingFunction='';
        });
        clearSigIcons();
        restoreRedDelayed(all);
      }
    })();
  }

  function runHalogen(primary=[],mirror=[],dir,token){
    primary=normalizeArr(primary); mirror=normalizeArr(mirror);
    const all=[...primary,...mirror];
    const sigIcos=getSignalButtons(dir);
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
            triggerSignalOnHaptic();
            all.forEach(s => {
                s.style.transitionDuration = '0.12s';
                s.style.transitionTimingFunction = 'ease-out';
                s.classList.add('ind');
            });
            iconsApply(sigIcos,'on',true,itok);
            await sleep(CFG.BLINK_ON);
        }
      if(state.signal==='none'){
        all.forEach(s=>{s.className='seg'; s.style.transitionDuration='';});
        clearSigIcons();
        restoreRedDelayed(all);
      }
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
        else if(mode==='USDM') runUSDMSequential(...groups,dir,token);
      else if(mode==='Halogen') runHalogen(...groups,dir,token);
  }

  async function lockUnlock(){if(state.sysBusy)return;if(restoreTimeout){clearTimeout(restoreTimeout);restoreTimeout=null}if(!state.on){state.on=true;triggerLockUnlockFlashHaptics(2);await hazardFlash(2,false,false);await sleep(CFG.WELCOME_DELAY);await systemSequence('welcome')}else{state.on=false;triggerLockUnlockFlashHaptics(1);await hazardFlash(1,true,false);await sleep(CFG.GOODBYE_DELAY);await systemSequence('goodbye')}}
  function changeMode(){clsAll(state.on);state.modeIdx=(state.modeIdx+1)%MODES.length;setModeLabel()}
  function toggleUI(){panel.style.display=panel.style.display==='none'?'':'none'}
  function resetReverseTestTapSequence(){reverseTestTapCount=0;if(reverseTestTapTimer){clearTimeout(reverseTestTapTimer);reverseTestTapTimer=null}}
  async function triggerSelfTests(){
    if(!testsBox||selfTestsRunning)return;
    testsBox.style.display='block';
    selfTestsRunning=true;
    try{
      await runSelfTests();
      const failed=testsBox.querySelectorAll('.fail').length;
      if(failed===0){
        if(!state.sysBusy){
          const audiModeIdx=0;
          if(state.signal==='hazard')activate('hazard');
          if(state.modeIdx!==audiModeIdx){
            state.modeIdx=audiModeIdx;
            setModeLabel();
          }
          activate('hazard');
        }
        await sleep(CFG.TEST_RELOAD_DELAY_MS);
        location.reload();
      }
    }finally{
      selfTestsRunning=false;
    }
  }
  function registerReverseTestTap(){
    reverseTestTapCount+=1;
    if(reverseTestTapTimer)clearTimeout(reverseTestTapTimer);
    reverseTestTapTimer=setTimeout(()=>resetReverseTestTapSequence(),CFG.REVERSE_TEST_WINDOW_MS);
    if(reverseTestTapCount>=CFG.REVERSE_TEST_TAP_COUNT){
      resetReverseTestTapSequence();
      triggerSelfTests();
    }
  }
  
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
      tHoldTimer=setTimeout(()=>triggerSelfTests(),500)
    }
  });
  
  document.addEventListener('keyup',e=>{
    const k=e.key.toLowerCase();
    down.delete(k);
    if(k==='s')releaseBrakeToHazard();
    else if(k==='q'){
      if(qHoldTimer){clearTimeout(qHoldTimer);qHoldTimer=null}
    }
    else if(k==='t'){
      if(tHoldTimer){clearTimeout(tHoldTimer);tHoldTimer=null}
    }
  });
  
  window.addEventListener('blur',()=>{down.clear();deactivateBrake()});
  window.addEventListener('resize',fitLightbarToShell);
  window.addEventListener('orientationchange',fitLightbarToShell);
  
  // Touch/Mobile Controls
  const setupTouchControls=()=>{
    btnCache.lock=$('#btnLock');
    btnCache.left=$('#btnLeft');
    btnCache.hazard=$('#btnHazard');
    btnCache.right=$('#btnRight');
    btnCache.brake=$('#btnBrake');
    btnCache.reverse=$('#btnReverse');
    btnCache.mode=$('#btnMode');

    const wirePressHaptic=button=>{
      if(!button)return;
      let lastHapticAt=0;
      const fireHaptic=()=>{
        const now=performance.now();
        if(now-lastHapticAt<120)return;
        lastHapticAt=now;
        triggerHaptic(CFG.HAPTIC_TAP_MS);
      };
      button.addEventListener('pointerdown',fireHaptic);
      button.addEventListener('touchstart',fireHaptic,{passive:true});
      button.addEventListener('mousedown',fireHaptic);
    };
    
    if(btnCache.lock)btnCache.lock.addEventListener('click',()=>lockUnlock());
    wirePressHaptic(btnCache.left);
    wirePressHaptic(btnCache.hazard);
    wirePressHaptic(btnCache.right);
    wirePressHaptic(btnCache.mode);
    if(btnCache.left)btnCache.left.addEventListener('click',()=>activate('left'));
    if(btnCache.hazard)btnCache.hazard.addEventListener('click',()=>activate('hazard'));
    if(btnCache.right)btnCache.right.addEventListener('click',()=>activate('right'));
    if(btnCache.mode)btnCache.mode.addEventListener('click',()=>changeMode());
    
    if(btnCache.brake){
      const stopBrake=()=>releaseBrakeToHazard();
      btnCache.brake.addEventListener('pointerdown',e=>{e.preventDefault();triggerHaptic(CFG.HAPTIC_TAP_MS);activateBrake()});
      btnCache.brake.addEventListener('pointerup',stopBrake);
      btnCache.brake.addEventListener('pointercancel',stopBrake);
      btnCache.brake.addEventListener('pointerleave',stopBrake);
    }
    
    if(btnCache.reverse){
      let reverseTimer=null;
      let reverseHoldTriggered=false;
      const clearReverseTimer=()=>{
        if(reverseTimer){clearTimeout(reverseTimer);reverseTimer=null}
      };
      const endReversePress=(countAsTap)=>{
        clearReverseTimer();
        if(countAsTap&&!reverseHoldTriggered)registerReverseTestTap();
      };
      btnCache.reverse.addEventListener('pointerdown',e=>{
        e.preventDefault();
        triggerHaptic(CFG.HAPTIC_TAP_MS);
        reverseHoldTriggered=false;
        clearReverseTimer();
        reverseTimer=setTimeout(()=>{reverseHoldTriggered=true;resetReverseTestTapSequence();toggleReverse();reverseTimer=null},CFG.REVERSE_HOLD_MS);
      });
      btnCache.reverse.addEventListener('pointerup',()=>endReversePress(true));
      btnCache.reverse.addEventListener('pointercancel',()=>endReversePress(false));
      btnCache.reverse.addEventListener('pointerleave',()=>endReversePress(false));
    }
  };
  
  // Self-tests
  function addResult(name,ok,err){const li=document.createElement('li');li.textContent=(ok?'PASS: ':'FAIL: ')+name+(ok?'':(err?' — '+(err.message?err.message:err):''));li.className=ok?'ok':'fail';testList.appendChild(li);testResults.push({name,ok,error:ok?null:(err&&err.message?err.message:String(err||''))})}
  function setSummary(total,passed,ms){if(testSummary)testSummary.textContent=passed+'/'+total+' passed in '+Math.round(ms)+' ms'}
  function segClassCount(cls){let n=0;const len=segs.length;for(let i=0;i<len;i++)if(segs[i].classList.contains(cls))n++;return n}
  function groupHasClass(group,cls){for(let i=0;i<group.length;i++)if(group[i].classList.contains(cls))return true;return false}
  function stopSignalIfActive(){if(state.signal==='left')activate('left');else if(state.signal==='right')activate('right');else if(state.signal==='hazard')activate('hazard')}
  function iconsAreClear(){
    const buttons=getSignalButtons('hazard');
    return buttons.every(btn=>!btn.classList.contains('on')&&!btn.classList.contains('dim'));
  }
  function dispatchKey(type,key){document.dispatchEvent(new KeyboardEvent(type,{key,bubbles:true}))}
  const testResults=[];
  async function runSelfTests(){testResults.length=0;testList.textContent='';const t0=performance.now();
    try{activate('left');await sleep(220);activate('left');addResult('left toggle',true)}catch(e){addResult('left toggle',false,e)}
    try{activate('right');await sleep(220);activate('right');addResult('right toggle',true)}catch(e){addResult('right toggle',false,e)}
    try{activate('hazard');await sleep(260);activate('hazard');addResult('hazard toggle resets icons',iconsAreClear(),'icons not cleared')}catch(e){addResult('hazard toggle resets icons',false,e)}
    try{activate('left');await sleep(120);activate('left');addResult('left cancel clears all classes',segClassCount('ind')===0&&segClassCount('ind-dim')===0&&iconsAreClear(),'classes or icons linger')}catch(e){addResult('left cancel clears all classes',false,e)}
    try{activate('right');await sleep(120);activate('hazard');await sleep(220);activate('hazard');addResult('right→hazard→off leaves icons clear',iconsAreClear(),'icons linger after hazard off')}catch(e){addResult('right→hazard→off leaves icons clear',false,e)}
    try{const prevOn=state.on,prevMode=state.modeIdx;state.on=true;state.modeIdx=3;setModeLabel();clsAll(true);activate('hazard');await sleep(140);activate('left');await sleep(CFG.RETURN_TO_RED_DELAY+140);const redLeak=groupHasClass(left,'on');stopSignalIfActive();state.modeIdx=prevMode;setModeLabel();state.on=prevOn;clsAll(state.on);addResult('hazard→left keeps active side non-red',!redLeak,'running red restored on active indicator side')}catch(e){stopSignalIfActive();addResult('hazard→left keeps active side non-red',false,e)}
    try{const prevOn=state.on,prevMode=state.modeIdx;state.on=true;state.modeIdx=3;setModeLabel();clsAll(true);activate('left');await sleep(140);activate('hazard');await sleep(CFG.RETURN_TO_RED_DELAY+140);const redLeak=groupHasClass(left,'on')||groupHasClass(right,'on');stopSignalIfActive();state.modeIdx=prevMode;setModeLabel();state.on=prevOn;clsAll(state.on);addResult('left→hazard keeps both sides non-red',!redLeak,'running red appeared during hazard')}catch(e){stopSignalIfActive();addResult('left→hazard keeps both sides non-red',false,e)}
    try{clsAll(false);deactivateBrake();activateBrake();const activeWhileHeld=state.brakeActive&&segClassCount('brake')>0&&statusBrake.classList.contains('brake')&&statusBrake.classList.contains('active');deactivateBrake();await sleep(60);const clearOnRelease=!state.brakeActive&&segClassCount('brake')===0&&!statusBrake.classList.contains('brake')&&!statusBrake.classList.contains('active');addResult('brake hold press/release',activeWhileHeld&&clearOnRelease,'held='+activeWhileHeld+', release='+clearOnRelease)}catch(e){addResult('brake hold press/release',false,e)}
    try{if(state.reverseActive)toggleReverse();if(qHoldTimer){clearTimeout(qHoldTimer);qHoldTimer=null}down.delete('q');const shortHold=Math.max(60,CFG.REVERSE_HOLD_MS-90);dispatchKey('keydown','q');await sleep(shortHold);dispatchKey('keyup','q');await sleep(80);const shortDoesNotToggle=!state.reverseActive;dispatchKey('keydown','q');await sleep(CFG.REVERSE_HOLD_MS+120);const longDoesToggle=state.reverseActive;dispatchKey('keyup','q');await sleep(60);const reverseStatusMatches=statusReverse.classList.contains('reverse')===state.reverseActive;if(state.reverseActive)toggleReverse();addResult('reverse hold timing threshold',shortDoesNotToggle&&longDoesToggle&&reverseStatusMatches,'short='+shortDoesNotToggle+', long='+longDoesToggle+', status='+reverseStatusMatches)}catch(e){if(state.reverseActive)toggleReverse();addResult('reverse hold timing threshold',false,e)}
    try{const before=state.modeIdx;activate('left');await sleep(100);changeMode();await sleep(200);activate('left');await sleep(150);activate('left');addResult('mode change during signal is stable',segClassCount('ind')===0&&segClassCount('ind-dim')===0&&iconsAreClear()&&state.modeIdx!==before,'residue after mode change')}catch(e){addResult('mode change during signal is stable',false,e)}
    try{clsAll(false);addResult('locked default has no lit segments',segClassCount('on')===0,'some segments lit on load')}catch(e){addResult('locked default has no lit segments',false,e)}
    try{const parsedMobile=getProfileOverride('?profile=mobile');const parsedDesktop=getProfileOverride('?profile=desktop');const forcedMobile=getInitialSegmentCount({profileOverride:parsedMobile,sliderValue:60,userAgent:'Mozilla/5.0',narrowViewport:false,coarsePointer:false});const forcedDesktop=getInitialSegmentCount({profileOverride:parsedDesktop,sliderValue:60,userAgent:'Mozilla/5.0',narrowViewport:true,coarsePointer:true});addResult('profile override defaults',forcedMobile===MOBILE_DEFAULT_SEGMENTS&&forcedDesktop===60,'mobile='+forcedMobile+', desktop='+forcedDesktop)}catch(e){addResult('profile override defaults',false,e)}
    const total=testResults.length,passed=testResults.filter(t=>t.ok).length;setSummary(total,passed,performance.now()-t0)}
  
  setModeLabel();
  setupTouchControls();
  startPresenceReporting();
})();
