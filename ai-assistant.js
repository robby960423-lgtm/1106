import { getAI, getGenerativeModel, GoogleAIBackend } from 'https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js';

const MODEL = 'gemini-3.8-flash';
const CONSENT_KEY = 'dayflow-ai-gemini-consent-v1';
const CATEGORIES = new Set(['work', 'personal', 'other']);
const categoryName = value => ({ work: '工作', personal: '個人', other: '其他' }[value] || '工作');
const dateToISO = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const todayISO = () => dateToISO(new Date());
const addDays = (date, days) => { const copy = new Date(date); copy.setDate(copy.getDate()+days); return copy; };
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2,12);
const minuteOf = time => { if(!/^\d{2}:\d{2}$/.test(time||''))return NaN; const [h,m]=time.split(':').map(Number); return h<24&&m<60?h*60+m:NaN; };
const toTime = minutes => `${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value||'') && dateToISO(new Date(`${value}T12:00:00`))===value;
const overlaps = (a,b) => a.date===b.date && minuteOf(a.time)<minuteOf(b.endTime) && minuteOf(a.endTime)>minuteOf(b.time);

export function setupAIAssistant({ app, appCheckReady, getUser, getItems, saveItem, deleteItems, onPlanSaved }) {
  const panel=document.querySelector('#aiPanel');
  const fab=document.querySelector('#aiFab');
  const closeButton=document.querySelector('#aiClose');
  const messagesElement=document.querySelector('#aiMessages');
  const form=document.querySelector('#aiChatForm');
  const input=document.querySelector('#aiInput');
  const sendButton=document.querySelector('#aiSend');
  const status=document.querySelector('#aiStatus');
  const consent=document.querySelector('#aiConsent');
  const consentCheckbox=document.querySelector('#aiConsentCheck');
  const consentButton=document.querySelector('#aiConsentAccept');
  const quickButtons=[...document.querySelectorAll('[data-ai-action]')];

  let open=false, busy=false, mode='chat', planContext=null, pendingDraft=null, pendingPlan=null, pendingDelete=null;
  const conversation=[];
  let textModel=null, jsonModel=null, initError='';

  if(appCheckReady){
    try{
      const ai=getAI(app,{backend:new GoogleAIBackend(),useLimitedUseAppCheckTokens:true});
      textModel=getGenerativeModel(ai,{model:MODEL,generationConfig:{temperature:.55,maxOutputTokens:1000}});
      jsonModel=getGenerativeModel(ai,{model:MODEL,generationConfig:{temperature:.1,maxOutputTokens:1200,responseMimeType:'application/json'}});
    }catch(error){console.error('Firebase AI Logic initialization failed',error);initError='Firebase AI Logic 尚未完成初始化。'}
  }

  function setStatus(message,isError=false){status.textContent=message||'';status.classList.toggle('error',isError)}
  function appendMessage(role,text){
    const bubble=document.createElement('div');bubble.className=`ai-message ${role}`;bubble.textContent=text;
    messagesElement.appendChild(bubble);messagesElement.scrollTop=messagesElement.scrollHeight;
    if(role==='user'||role==='assistant')conversation.push({role,text});
    return bubble;
  }
  function appendActionCard(title,details,buttonText,onConfirm,onCancel,warning=''){
    const card=document.createElement('section');card.className='ai-action-card';
    const heading=document.createElement('strong');heading.textContent=title;card.appendChild(heading);
    const body=document.createElement('div');body.className='ai-action-details';body.textContent=details;card.appendChild(body);
    if(warning){const warn=document.createElement('p');warn.className='ai-action-warning';warn.textContent=warning;card.appendChild(warn)}
    const actions=document.createElement('div');actions.className='ai-action-buttons';
    const confirm=document.createElement('button');confirm.type='button';confirm.className='ai-action-confirm';confirm.textContent=buttonText;
    const cancel=document.createElement('button');cancel.type='button';cancel.className='ai-action-cancel';cancel.textContent='取消';
    confirm.addEventListener('click',async()=>{confirm.disabled=true;cancel.disabled=true;await onConfirm(confirm,cancel)});
    cancel.addEventListener('click',()=>{onCancel();card.remove()});
    actions.append(confirm,cancel);card.appendChild(actions);messagesElement.appendChild(card);messagesElement.scrollTop=messagesElement.scrollHeight;return card;
  }
  function userCanUseAI(){
    if(!getUser()){setStatus('請先登入後使用 AI 助手。',true);return false}
    if(!textModel||!jsonModel){setStatus(initError||'Firebase AI Logic 尚未完成設定；請先完成 Firebase AI Logic 與 App Check 設定。',true);return false}
    return true;
  }
  function setBusy(value){
    busy=value;sendButton.disabled=value||!input.value.trim();input.disabled=value;
    quickButtons.forEach(button=>button.disabled=value);
    form.setAttribute('aria-busy',String(value));
    if(value)setStatus('Gemini 正在整理…');
  }
  function acceptedConsent(){try{return localStorage.getItem(CONSENT_KEY)==='accepted'}catch{return false}}
  function refreshConsent(){const accepted=acceptedConsent();consent.hidden=accepted;form.hidden=!accepted;quickButtons.forEach(button=>button.disabled=!accepted||busy)}
  function openPanel(){open=true;panel.classList.add('open');panel.setAttribute('aria-hidden','false');fab.setAttribute('aria-expanded','true');refreshConsent();if(!acceptedConsent())consentCheckbox.focus();else input.focus();}
  function closePanel(){open=false;panel.classList.remove('open');panel.setAttribute('aria-hidden','true');fab.setAttribute('aria-expanded','false');fab.focus();}
  function modelHistory(){return conversation.slice(-12).map(message=>`${message.role==='user'?'使用者':'助手'}：${message.text}`).join('\n')}
  function relevantContext(items,days=7){
    const start=todayISO(),end=dateToISO(addDays(new Date(),days));
    return {
      date:start,
      timezone:'Asia/Taipei',
      events:items.filter(item=>item.type==='event'&&item.date>=start&&item.date<=end).map(({id,name,date,time,endTime})=>({id,name,date,time:time||'全天',endTime:endTime||''})),
      tasks:items.filter(item=>item.type==='task'&&!item.done&&item.date<=end).map(({id,name,date,category,done})=>({id,name,dueDate:date,category:categoryName(category),done:Boolean(done)}))
    };
  }
  function todayAvailability(events){
    if(events.some(event=>!Number.isFinite(minuteOf(event.time))||!Number.isFinite(minuteOf(event.endTime))))return [];
    const workStart=9*60,workEnd=18*60;
    const busy=events.map(event=>({start:minuteOf(event.time),end:minuteOf(event.endTime)}))
      .filter(event=>Number.isFinite(event.start)&&Number.isFinite(event.end)&&event.end>event.start)
      .map(event=>({start:Math.max(workStart,event.start),end:Math.min(workEnd,event.end)}))
      .filter(event=>event.end>event.start)
      .sort((a,b)=>a.start-b.start);
    const slots=[];let cursor=workStart;
    for(const event of busy){if(event.start>cursor)slots.push(`${toTime(cursor)}–${toTime(event.start)}`);cursor=Math.max(cursor,event.end)}
    if(cursor<workEnd)slots.push(`${toTime(cursor)}–${toTime(workEnd)}`);
    return slots;
  }
  async function generateText(prompt){const result=await textModel.generateContent(prompt);const response=await result.response;return response.text().trim()}
  async function generateJSON(prompt){
    const result=await jsonModel.generateContent(prompt);const response=await result.response;
    const text=response.text().trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    return JSON.parse(text);
  }
  function handleModelError(error){
    console.error('Firebase AI Logic request failed',error);
    const code=error?.code||'';
    if(code.includes('app-check')||String(error?.message||'').toLowerCase().includes('app check'))return 'AI 安全驗證未通過。請檢查 Firebase App Check 網域與網站設定。';
    if(code.includes('quota')||code.includes('resource-exhausted'))return 'Gemini 免費額度或速率限制已達上限，請稍後再試。';
    if(code.includes('permission')||code.includes('permission-denied'))return 'Firebase AI Logic 尚未啟用或目前帳戶沒有使用權限。';
    return 'AI 暫時無法回應，請稍後再試。';
  }
  function makeSystemPrompt(){return '你是日常 Dayflow 的繁體中文規劃助手。使用者的資料只可用於當前問題；不要假裝已經儲存、修改或刪除資料。新增、排程或刪除都必須先顯示草稿並等使用者在畫面按下確認。時間以 Asia/Taipei 為準；資訊不足時先提問，不要猜測。不要要求或重複密碼、驗證碼或其他機密。'}
  function setMode(next){mode=next;const placeholders={chat:'詢問行程、待辦，或直接輸入新增／刪除指令…',create:'例如：明天下午 3 點和小林開會…',plan:'告訴我未設定預估時間的待辦需要多久…',delete:'例如：刪除明天的牙醫回診…'};input.placeholder=placeholders[next]||placeholders.chat;}

  async function summarizeToday(){
    if(!userCanUseAI())return;
    const context=relevantContext(getItems(),0);context.availableSlots=todayAvailability(context.events);appendMessage('user','整理今天');setBusy(true);
    try{const answer=await generateText(`${makeSystemPrompt()}\n請用簡潔條列整理今天的行程、未完成待辦和可安排空檔。可安排空檔只使用 availableSlots 欄位，並說明範圍為 09:00–18:00。只陳述資料支持的內容；若某類資料為空，直接說明。資料（不含備註）：${JSON.stringify(context)}`);appendMessage('assistant',answer);setStatus('整理完成。')}
    catch(error){setStatus(handleModelError(error),true)}finally{setBusy(false)}
  }
  function validDraft(raw){
    if(!raw||!['event','task'].includes(raw.type)||!String(raw.name||'').trim()||!validDate(raw.date))return null;
    const draft={type:raw.type,name:String(raw.name).trim().slice(0,80),date:raw.date,category:CATEGORIES.has(raw.category)?raw.category:'work',note:''};
    if(draft.type==='event'){
      const start=minuteOf(raw.time);if(!Number.isFinite(start))return null;
      let end=minuteOf(raw.endTime);if(!Number.isFinite(end))end=start+60;
      if(end<=start||end>24*60)return null;
      draft.time=toTime(start);draft.endTime=toTime(end);
    }else{draft.reminder=Number.isFinite(Number(raw.reminder))?Math.max(0,Math.min(365,Number(raw.reminder))):1;draft.done=false}
    return draft;
  }
  function draftDescription(draft){return draft.type==='event'?`${draft.name}\n${draft.date}　${draft.time}–${draft.endTime}\n分類：${categoryName(draft.category)}`:`${draft.name}\n到期日：${draft.date}\n分類：${categoryName(draft.category)}　提前 ${draft.reminder} 天提醒`;}
  async function confirmDraft(confirm,cancel){
    if(!pendingDraft)return;
    try{const item={...pendingDraft,id:uid()};await saveItem(item);appendMessage('assistant',`已新增${item.type==='event'?'行程':'待辦'}「${item.name}」。`);pendingDraft=null;confirm.closest('.ai-action-card')?.remove();setStatus('已儲存至 Firestore。')}
    catch(error){console.error('Saving AI draft failed',error);setStatus('儲存失敗；資料沒有確認寫入，請重試。',true);confirm.disabled=false;cancel.disabled=false}
  }
  async function createFromText(message){
    const now=new Date();const date=dateToISO(now);appendMessage('user',message);setBusy(true);
    const prompt=`${makeSystemPrompt()}\n目前日期是 ${date}，現在時間 ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}。根據最近對話，解析使用者想新增的一筆行程或待辦；使用者可能正在補充你前次追問的欄位。若是行程，未提供結束時間時可預設 60 分鐘；若缺少名稱、日期或行程開始時間，請在 reply 詢問，draft 設為 null。不要替使用者填寫備註。只輸出 JSON，格式：{"reply":"確認或追問","draft":null 或 {"type":"event|task","name":"名稱","date":"YYYY-MM-DD","time":"HH:mm","endTime":"HH:mm","category":"work|personal|other","reminder":1}}。最近對話：\n${modelHistory()}`;
    try{
      const result=await generateJSON(prompt);const draft=validDraft(result.draft);
      appendMessage('assistant',String(result.reply|| (draft?'我整理了一份草稿，請確認後儲存。':'請補充行程或待辦資訊。')));
      if(!draft){setMode('create');setStatus('補充資訊後我會再整理。');return}
      pendingDraft=draft;setMode('chat');
      const conflicts=draft.type==='event'?getItems().filter(item=>item.type==='event'&&overlaps(item,draft)):[];
      appendActionCard(draft.type==='event'?'行程草稿':'待辦草稿',draftDescription(draft),conflicts.length?'仍要新增':draft.type==='event'?'確認新增行程':'確認新增待辦',confirmDraft,()=>{pendingDraft=null;setStatus('已取消草稿。')},conflicts.length?`時間與「${conflicts.map(item=>item.name).join('、')}」重疊，請確認是否仍要新增。`:'' );
      setStatus('草稿尚未寫入 Firestore；請在下方草稿卡按「確認新增」完成新增。');
    }catch(error){setStatus(error instanceof SyntaxError?'我無法確認草稿格式，請換個方式描述。':handleModelError(error),true)}finally{setBusy(false)}
  }
  async function confirmDelete(confirm,cancel){
    if(!pendingDelete)return;
    const selected=pendingDelete.item;
    const all=getItems();
    const current=all.find(item=>item.id===selected.id);
    const linkedStillExist=pendingDelete.linkedEvents.every(event=>all.some(item=>item.id===event.id&&item.name===event.name&&item.date===event.date));
    if(!current||current.type!==selected.type||current.name!==selected.name||current.date!==selected.date||!linkedStillExist){
      pendingDelete=null;setStatus('這筆資料已變更或不存在，請重新描述要刪除的項目。',true);confirm.disabled=false;cancel.disabled=false;return;
    }
    try{
      await deleteItems([selected.id,...pendingDelete.linkedEvents.map(event=>event.id)]);
      appendMessage('assistant',`已刪除${selected.type==='event'?'行程':'待辦'}「${selected.name}」${pendingDelete.linkedEvents.length?`，並一併移除 ${pendingDelete.linkedEvents.length} 個 AI 專注時段`:''}。`);
      pendingDelete=null;confirm.closest('.ai-action-card')?.remove();setStatus('已從 Firestore 刪除。');
    }catch(error){console.error('Deleting AI selected item failed',error);setStatus('刪除失敗；資料尚未確認刪除，請重試。',true);confirm.disabled=false;cancel.disabled=false}
  }
  async function deleteFromText(message){
    appendMessage('user',message);setBusy(true);
    const candidates=getItems().filter(item=>item.type==='event'||item.type==='task').map(({id,type,name,date,time,endTime,done})=>({id,type,name,date,time:time||'',endTime:endTime||'',done:Boolean(done)}));
    if(!candidates.length){appendMessage('assistant','目前沒有可刪除的行程或待辦。');setMode('chat');setStatus('沒有符合項目。');setBusy(false);return}
    const prompt=`${makeSystemPrompt()}\n使用者要求刪除一筆行程或待辦。只可從候選資料中選一個最明確符合使用者描述的項目；絕不可猜測、編造或刪除多筆。名稱或日期不足以唯一辨識、候選有歧義、或沒有符合項目時，itemId 必須為 null，並在 reply 詢問具體名稱或日期。完成辨識時仍不可聲稱已刪除，只告訴使用者要先確認。只輸出 JSON：{"reply":"辨識結果或追問","itemId":null 或 "候選資料中的原始 id"}。最近對話：\n${modelHistory()}\n可刪除項目（不含備註）：${JSON.stringify(candidates)}`;
    try{
      const result=await generateJSON(prompt);
      const selected=candidates.find(item=>item.id===result.itemId);
      appendMessage('assistant',String(result.reply||(selected?'我找到一筆項目，請檢查下方內容並確認刪除。':'請提供名稱或日期，讓我辨識要刪除的項目。')));
      if(!selected){setMode('delete');setStatus('尚未刪除；請補充項目名稱或日期。');return}
      const linkedEvents=selected.type==='task'?getItems().filter(item=>item.type==='event'&&item.assistantGenerated===true&&item.linkedTaskId===selected.id):[];
      pendingDelete={item:selected,linkedEvents};setMode('chat');
      const details=selected.type==='event'?`${selected.name}\n${selected.date}　${selected.time||'全天'}${selected.endTime?`–${selected.endTime}`:''}`:`${selected.name}\n到期日：${selected.date}${selected.done?'\n狀態：已完成':''}${linkedEvents.length?`\nAI 專注時段也會一起移除：\n${linkedEvents.map(event=>`${event.date} ${event.time||''} ${event.name}`).join('\n')}`:''}`;
      appendActionCard(`確認刪除${selected.type==='event'?'行程':'待辦'}`,details,`確認刪除${selected.type==='event'?'行程':'待辦'}`,confirmDelete,()=>{pendingDelete=null;setStatus('已取消刪除。')},'刪除後無法復原，請確認項目名稱與日期正確。');
      setStatus('項目尚未刪除；請在下方卡片檢查內容後按「確認刪除」。');
    }catch(error){setStatus(error instanceof SyntaxError?'我無法確認要刪除的項目，請補充名稱或日期。':handleModelError(error),true)}finally{setBusy(false)}
  }
  function getPlanContext(){
    const start=todayISO(),end=dateToISO(addDays(new Date(),7));
    const all=getItems();const scheduledIds=new Set(all.filter(item=>item.type==='event'&&item.linkedTaskId).map(item=>item.linkedTaskId));
    const tasks=all.filter(item=>item.type==='task'&&!item.done&&item.date<=end&&!scheduledIds.has(item.id)).map(({id,name,date,category,durationMinutes})=>({id,name,dueDate:date,category:categoryName(category),estimatedMinutes:Number(durationMinutes)||null}));
    const events=all.filter(item=>item.type==='event'&&item.date>=start&&item.date<=end).map(({id,name,date,time,endTime})=>({id,name,date,time:time||'全天',endTime:endTime||''}));
    return {startDate:start,endDate:end,timezone:'Asia/Taipei',workingWindow:'09:00-18:00',tasks,events};
  }
  function validPlan(raw,context){
    if(!Array.isArray(raw)||!raw.length)return null;
    const known=new Map(context.tasks.map(task=>[task.id,task]));const seen=new Set();const result=[];
    for(const slot of raw){
      const task=known.get(slot.taskId),start=minuteOf(slot.time),end=minuteOf(slot.endTime),duration=Number(slot.durationMinutes);
      if(!task||seen.has(task.id)||!validDate(slot.date)||slot.date<context.startDate||slot.date>context.endDate||!Number.isFinite(start)||!Number.isFinite(end)||start<9*60||end>18*60||end<=start||duration<5||duration>480||end-start!==duration)return null;
      seen.add(task.id);result.push({taskId:task.id,taskName:task.name,date:slot.date,time:slot.time,endTime:slot.endTime,durationMinutes:duration,category:task.category});
    }
    if(result.length!==context.tasks.length)return null;
    const existing=context.events.filter(event=>event.time&&event.endTime);
    for(let i=0;i<result.length;i++){
      const slot=result[i];if(existing.some(event=>overlaps(event,slot)))return null;
      if(result.slice(i+1).some(other=>overlaps(slot,other)))return null;
    }
    return result;
  }
  async function savePlan(confirm,cancel){
    if(!pendingPlan)return;confirm.disabled=true;cancel.disabled=true;
    try{
      for(const slot of pendingPlan.slots){
        await saveItem({id:`${pendingPlan.id}_${slot.taskId}`,type:'event',name:`專注時段｜${slot.taskName}`,date:slot.date,time:slot.time,endTime:slot.endTime,category:slot.category,note:'',linkedTaskId:slot.taskId,assistantGenerated:true});
      }
      appendMessage('assistant',`已將 ${pendingPlan.slots.length} 個專注時段加入行事曆並儲存至 Firestore。`);pendingPlan=null;onPlanSaved?.();setStatus('排程已儲存。');
    }catch(error){console.error('Saving AI plan failed',error);setStatus('部分排程可能已儲存；再次確認可安全重試。',true);confirm.disabled=false;cancel.disabled=false}
  }
  async function arrangeTasks(message='安排接下來七天的待辦'){
    if(!userCanUseAI())return;
    planContext ||= getPlanContext();
    if(!planContext.tasks.length){appendMessage('assistant','接下來七天沒有尚未安排的待辦。');setStatus('目前沒有需要安排的待辦。');setMode('chat');return}
    if(message)appendMessage('user',message);setBusy(true);
    const prompt=`${makeSystemPrompt()}\n你要替使用者安排未完成待辦。工作時間採 ${planContext.workingWindow}，時區 Asia/Taipei；排在今日至 ${planContext.endDate}，盡可能安排在到期日前，避開既有行程與其他工作時段。待辦若沒有 estimatedMinutes，且對話中也沒有使用者提供的明確估時，先提問每項需要幾分鐘，plan 設為 null；不要自行猜時長。時長資訊充足後，每項待辦恰好排一次。只輸出 JSON：{"reply":"給使用者的說明","plan":null 或 [{"taskId":"既有待辦 id","date":"YYYY-MM-DD","time":"HH:mm","endTime":"HH:mm","durationMinutes":30}]}。使用者與助手對話：\n${modelHistory()}\n排程資料（不含備註）：${JSON.stringify(planContext)}`;
    try{
      const result=await generateJSON(prompt);const slots=validPlan(result.plan,planContext);
      appendMessage('assistant',String(result.reply|| (slots?'請確認以下排程。':'請提供缺少的預估時間。')));
      if(!slots){setMode('plan');setStatus('補充預估時間後，我會再安排。');return}
      pendingPlan={id:uid(),slots};setMode('chat');
      const details=slots.map(slot=>`${slot.date}　${slot.time}–${slot.endTime}　${slot.taskName}（${slot.durationMinutes} 分鐘）`).join('\n');
      appendActionCard('待辦排程草稿',details,'確認加入行事曆',savePlan,()=>{pendingPlan=null;setStatus('已取消排程草稿。')});setStatus('排程草稿尚未寫入 Firestore。');
    }catch(error){setStatus(error instanceof SyntaxError?'我無法確認排程格式，請重新安排。':handleModelError(error),true)}finally{setBusy(false)}
  }
  async function sendChatMessage(message){
    if(!message||!userCanUseAI())return;
    if(mode==='create'){await createFromText(message);return}
    if(mode==='plan'){await arrangeTasks(message);return}
    if(mode==='delete'){await deleteFromText(message);return}
    const asksToDelete=/(刪除|刪掉|移除|清掉|清除|取消)/i.test(message);
    if(asksToDelete){setMode('delete');await deleteFromText(message);return}
    const asksToCreate=/(新增|建立|加上|加一個|加一筆|幫我加|幫我新增|幫我建立|排入)/i.test(message);
    if(asksToCreate){setMode('create');await createFromText(message);return}
    appendMessage('user',message);setBusy(true);
    const referencesPlanner=/(行程|待辦|今天|明天|這週|本週|下週|空檔|安排|期限|到期|schedule|task|calendar)/i.test(message)||/(行程|待辦|空檔|安排)/i.test(modelHistory());
    const context=referencesPlanner?relevantContext(getItems(),7):null;
    const prompt=`${makeSystemPrompt()}\n請回答使用者的最新訊息。若需要規劃資料，只能使用下方提供的精簡資料；沒有提供的資料就先詢問。此模式只能討論與建議，不可聲稱已儲存或修改。\n${context?`行程與待辦（不含備註）：${JSON.stringify(context)}\n`:''}最近對話：\n${modelHistory()}`;
    try{appendMessage('assistant',await generateText(prompt));setStatus('回覆完成。')}
    catch(error){setStatus(handleModelError(error),true)}finally{setBusy(false)}
  }

  fab.addEventListener('click',()=>open?closePanel():openPanel());closeButton.addEventListener('click',closePanel);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&open)closePanel()});
  consentButton.addEventListener('click',()=>{
    if(!consentCheckbox.checked){setStatus('請先確認你了解免費 Gemini 的資料使用方式。',true);return}
    try{localStorage.setItem(CONSENT_KEY,'accepted')}catch{}
    refreshConsent();setStatus('已記住你的選擇；聊天僅保留在此頁面工作階段。');input.focus();
  });
  quickButtons.forEach(button=>button.addEventListener('click',async()=>{
    if(!acceptedConsent()){refreshConsent();return}
    const action=button.dataset.aiAction;
    if(action==='today'){setMode('chat');await summarizeToday()}
    else if(action==='create'){setMode('create');appendMessage('assistant','請描述要新增的行程或待辦。草稿會先顯示給你確認。');setStatus('輸入資料後按送出。');input.focus()}
    else if(action==='plan'){planContext=getPlanContext();setMode('plan');await arrangeTasks()}
    else if(action==='delete'){setMode('delete');appendMessage('assistant','請描述要刪除的行程或待辦。我會先列出辨識結果，只有你按下確認刪除後才會執行。');setStatus('目前資料不會立即變更。');input.focus()}
  }));
  input.addEventListener('input',()=>{sendButton.disabled=busy||!input.value.trim()});
  form.addEventListener('submit',async event=>{event.preventDefault();const message=input.value.trim();if(!message||busy)return;input.value='';sendButton.disabled=true;await sendChatMessage(message);input.focus()});
  if(!appCheckReady||!textModel){setStatus(initError||'尚待完成 Firebase AI Logic 與 App Check 設定；完成後即可使用。',true)}
  refreshConsent();
}
