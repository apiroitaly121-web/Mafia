const http=require('http'),fs=require('fs'),path=require('path'),{WebSocketServer}=require('ws');
const R={
nas:{n:'Nașul',t:'mafia',d:'Conduci mafia. Noaptea alegi pe cine ucideți. Apari NEVINOVAT pentru Șerif. Dacă ești blocat sau mort, Mafiotul execută uciderea.',l:'Pe cine ucizi?'},
mafiot:{n:'Mafiotul',t:'mafia',d:'Execuți uciderea de noapte dacă Nașul e mort sau blocat.',l:'Pe cine ucizi (dacă Nașul nu poate)?'},
consilier:{n:'Consilierul',t:'mafia',d:'În fiecare noapte afli rolul exact al unui jucător.',l:'Pe cine investighezi?'},
seducatoare:{n:'Seducătoarea',t:'mafia',d:'Blochezi acțiunea de noapte a unui jucător (nu își poate folosi rolul).',l:'Pe cine blochezi?'},
incastrator:{n:'Incastratorul',t:'mafia',d:'Alegi un jucător care va apărea SUSPECT pentru Șerif în noaptea aceea.',l:'Pe cine încastrezi?'},
serif:{n:'Șeriful',t:'oras',d:'Verifici un jucător: SUSPECT sau NEVINOVAT. Nașul și neutrii apar nevinovați; cei încastrați apar suspecți.',l:'Pe cine verifici?'},
doctor:{n:'Doctorul',t:'oras',d:'Salvezi un jucător de la moarte. Te poți salva pe tine o singură dată.',l:'Pe cine salvezi?'},
bodyguard:{n:'Bodyguardul',t:'oras',d:'Protejezi un jucător. Dacă e atacat, mori tu și atacatorul în locul lui.',l:'Pe cine aperi?'},
urmaritor:{n:'Urmăritorul',t:'oras',d:'Afli pe cine a vizitat ținta ta în timpul nopții.',l:'Pe cine urmărești?'},
observator:{n:'Observatorul',t:'oras',d:'Afli cine a vizitat ținta ta în timpul nopții.',l:'Ce casă observi?'},
justitiar:{n:'Justițiarul',t:'oras',d:'Ai 2 gloanțe. Dacă împuști un orășean, mori din remușcare.',l:'Pe cine împuști?'},
primar:{n:'Primarul',t:'oras',d:'Ziua îți poți dezvălui rolul. După aceea votul tău valorează dublu. Rol pasiv.'},
curtezana:{n:'Curtezana',t:'oras',d:'Blochezi un jucător. Vizitele tale nu apar la Urmăritor sau Observator.',l:'Pe cine blochezi?'},
vanator:{n:'Vânătorul',t:'oras',d:'Dacă ești eliminat prin vot, iei cu tine un jucător care a votat împotriva ta. Rol pasiv.'},
veteran:{n:'Veteranul',t:'oras',d:'Ai 2 alerte. În noaptea de alertă ești imun și ucizi pe oricine te vizitează.',l:'Intri în alertă?'},
ucigas:{n:'Ucigașul în serie',t:'neutru',d:'Ucizi în fiecare noapte. Câștigi dacă rămâi ultimul în viață. Ești imun la prima tentativă de omor. Apari nevinovat.',l:'Pe cine ucizi?'},
bufon:{n:'Bufonul',t:'neutru',d:'Câștigi dacă ești votat spre eliminare de oraș. Rol pasiv.'},
mostenitor:{n:'Moștenitorul',t:'neutru',d:'În prima noapte alegi un jucător. Când acesta moare, îi preiei rolul și echipa. Dacă el supraviețuiește până la final, pierzi.',l:'Pe cine moștenești?'}
};
const MIN=5,MAX=20,NIGHT=40,DAY=100,rooms=new Map();
const rnd=a=>a[Math.floor(Math.random()*a.length)];
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const send=(p,o)=>{if(p.ws&&p.ws.readyState===1)p.ws.send(JSON.stringify(o));};
const by=(room,id)=>room.ps.find(x=>x.id===id);
const all=(room,o,f=()=>true)=>room.ps.filter(f).forEach(p=>send(p,o));
const pub=(room,text)=>all(room,{t:'log',text});
const priv=(p,text)=>send(p,{t:'priv',text});
const canAct=(room,p)=>{const r=R[p.role];if(!p.alive||!r||!r.l)return false;if(p.role==='mostenitor')return room.day===1&&!p.heir;if(p.role==='justitiar'||p.role==='veteran')return p.uses>0;return true;};

function roleList(n){
 const m=Math.max(1,Math.floor(n*0.3+0.2)),k=n>=15?3:n>=10?2:n>=7?1:0;
 const mo=['nas','mafiot','consilier','seducatoare','incastrator','mafiot'],ne=['ucigas','bufon','mostenitor'],
 to=['serif','doctor','bodyguard','urmaritor','justitiar','primar','curtezana','observator','vanator','veteran'];
 const out=[];for(let i=0;i<m;i++)out.push(mo[i%mo.length]);for(let i=0;i<k;i++)out.push(ne[i]);
 for(let i=0;out.length<n;i++)out.push(to[i%to.length]);return shuffle(out);
}
function stateFor(room,p){
 const left=room.end?Math.max(0,room.end-Date.now()):0,ended=room.phase==='ended';
 return{t:'state',code:room.code,phase:room.phase,day:room.day,left,winner:room.winner,jester:room.jester,
 me:{id:p.id,name:p.name,role:p.role,team:p.team,alive:p.alive,host:room.host===p.id,can:room.phase==='night'&&canAct(room,p),
  picked:p.act,voted:p.vote,uses:p.uses,revealed:p.revealed,
  mates:p.team==='mafia'?room.ps.filter(x=>x!==p&&x.team==='mafia').map(x=>x.name+' ('+R[x.role].n+')'):[]},
 players:room.ps.map(x=>({id:x.id,name:x.name,alive:x.alive,online:!!x.ws,host:room.host===x.id,
  role:(!x.alive||ended||x.revealed)?x.role:null,
  votes:room.phase==='day'?room.ps.filter(v=>v.alive&&v.vote===x.id).reduce((s,v)=>s+(v.revealed&&v.role==='primar'?2:1),0):0}))};
}
const bc=room=>room.ps.forEach(p=>send(p,stateFor(room,p)));

function startNight(room){
 room.day++;room.phase='night';room.ps.forEach(p=>{p.act=null;});
 room.end=Date.now()+NIGHT*1000;pub(room,`— Noaptea ${room.day} —`);
 clearTimeout(room.timer);room.timer=setTimeout(()=>resolveNight(room),NIGHT*1000);bc(room);
}
function startDay(room){
 room.phase='day';room.ps.forEach(p=>{p.vote=undefined;});
 room.end=Date.now()+DAY*1000;pub(room,`— Ziua ${room.day}: discutați și votați —`);
 clearTimeout(room.timer);room.timer=setTimeout(()=>endDay(room),DAY*1000);bc(room);
}
function die(room,p,why){
 if(!p.alive)return;p.alive=false;pub(room,`${p.name} ${why} Era ${R[p.role].n}.`);
 room.ps.filter(h=>h.alive&&h.role==='mostenitor'&&h.heir===p.id).forEach(h=>{
  h.role=p.role;h.team=p.team;h.uses=p.uses;priv(h,`Ținta ta a murit. Ai moștenit rolul ${R[h.role].n} (${h.team}).`);});
}
function check(room){
 const al=room.ps.filter(p=>p.alive),m=al.filter(p=>p.team==='mafia').length,sk=al.filter(p=>p.role==='ucigas').length,o=al.length-m;
 let w=null;
 if(!al.length)w='Nimeni';else if(!m&&!sk)w='Orașul';else if(m&&m>=o)w='Mafia';else if(sk&&!m&&al.length<=2)w='Ucigașul în serie';
 if(!w)return false;
 room.winner=w;room.phase='ended';room.end=0;clearTimeout(room.timer);pub(room,`Joc terminat. Câștigă: ${w}!`);bc(room);return true;
}
function resolveNight(room){
 clearTimeout(room.timer);
 const live=room.ps.filter(p=>p.alive);
 const acts=live.filter(p=>canAct(room,p)&&p.act).map(p=>({p,t:by(room,p.act)})).filter(a=>a.t);
 acts.filter(a=>a.p.role==='seducatoare'||a.p.role==='curtezana').forEach(a=>{a.t.blocked=true;});
 live.forEach(p=>{if(p.blocked&&R[p.role].l)priv(p,'Ai fost blocat în noaptea asta.');});
 const A=acts.filter(a=>!a.p.blocked);
 A.forEach(a=>{if(a.p.role==='justitiar'||a.p.role==='veteran')a.p.uses--;if(a.p.role==='doctor'&&a.t===a.p)a.p.selfHeal--;});
 const vis=A.filter(a=>a.p.role!=='curtezana');
 A.filter(a=>a.p.role==='incastrator').forEach(a=>{a.t.framed=true;});
 A.filter(a=>a.p.role==='mostenitor').forEach(a=>{a.p.heir=a.t.id;priv(a.p,`Îl moștenești pe ${a.t.name}.`);});
 const dead=new Map(),kill=(p,why)=>{if(!dead.has(p))dead.set(p,why);};
 const alert=A.filter(a=>a.p.role==='veteran').map(a=>a.p);
 A.forEach(a=>{if(alert.includes(a.t)&&a.p!==a.t){kill(a.p,'a fost ucis de Veteran în timpul vizitei.');priv(a.t,`${a.p.name} te-a vizitat și a fost ucis.`);}});
 const heal=A.filter(a=>a.p.role==='doctor'),guards=A.filter(a=>a.p.role==='bodyguard'),att=[];
 const mk=A.find(a=>a.p.role==='nas')||A.find(a=>a.p.role==='mafiot');if(mk)att.push(mk);
 A.filter(a=>a.p.role==='ucigas'||a.p.role==='justitiar').forEach(a=>att.push(a));
 for(const {p:atk,t} of att){
  if(dead.has(t)||alert.includes(t))continue;
  const g=guards.find(x=>x.t===t&&!dead.has(x.p));
  if(g){kill(g.p,'a murit apărându-și protejatul.');kill(atk,'a fost ucis de un Bodyguard.');priv(t,'Cineva te-a atacat, dar Bodyguardul te-a salvat.');continue;}
  const d=heal.find(x=>x.t===t);
  if(d){priv(d.p,'Pacientul tău a fost atacat, dar l-ai salvat!');priv(t,'Ai fost atacat, dar un doctor te-a salvat.');continue;}
  if(t.role==='ucigas'&&!t.immune){t.immune=true;priv(t,'Ai fost atacat, dar ai supraviețuit.');continue;}
  kill(t,atk.role==='ucigas'?'a fost ucis de un criminal în serie.':atk.role==='justitiar'?'a fost împușcat de Justițiar.':'a fost ucis de Mafia.');
  if(atk.role==='justitiar'&&t.team==='oras')kill(atk,'s-a sinucis din remușcare.');
 }
 A.forEach(({p,t})=>{
  if(p.role==='serif')priv(p,`${t.name} este ${(t.team==='mafia'&&t.role!=='nas')||t.framed?'SUSPECT':'NEVINOVAT'}.`);
  if(p.role==='consilier')priv(p,`${t.name} este ${R[t.role].n}.`);
  if(p.role==='urmaritor'){const l=vis.filter(x=>x.p===t).map(x=>x.t.name);priv(p,`${t.name} a vizitat: ${l.join(', ')||'nimeni'}.`);}
  if(p.role==='observator'){const l=vis.filter(x=>x.t===t&&x.p!==p).map(x=>x.p.name);priv(p,`Pe ${t.name} l-au vizitat: ${l.join(', ')||'nimeni'}.`);}
 });
 dead.forEach((why,p)=>die(room,p,why));
 if(!dead.size)pub(room,'Nimeni nu a murit în noaptea asta.');
 room.ps.forEach(p=>{p.blocked=false;p.framed=false;p.act=null;});
 if(!check(room))startDay(room);
}
function endDay(room){
 clearTimeout(room.timer);
 const live=room.ps.filter(p=>p.alive),cnt=new Map();
 live.forEach(p=>{if(p.vote){const t=by(room,p.vote);if(t)cnt.set(t,(cnt.get(t)||0)+(p.revealed&&p.role==='primar'?2:1));}});
 let best=0,top=[];cnt.forEach((v,t)=>{if(v>best){best=v;top=[t];}else if(v===best)top.push(t);});
 if(top.length===1){
  const t=top[0];pub(room,`Orașul a votat eliminarea lui ${t.name}.`);die(room,t,'a fost eliminat prin vot.');
  if(t.role==='bufon'){room.jester=t.name;pub(room,`${t.name} a fost Bufonul și a câștigat!`);}
  if(t.role==='vanator'){const v=live.filter(p=>p.alive&&p.vote===t.id);if(v.length)die(room,rnd(v),'a fost împușcat de Vânător.');}
 }else pub(room,'Egalitate sau niciun vot: nimeni nu e eliminat.');
 if(!check(room))startNight(room);
}
function startGame(room){
 const rl=roleList(room.ps.length);room.jester=null;room.winner=null;room.day=0;
 room.ps.forEach((p,i)=>Object.assign(p,{role:rl[i],team:R[rl[i]].t,alive:true,uses:2,selfHeal:1,immune:false,heir:null,revealed:false,act:null,vote:undefined,blocked:false,framed:false}));
 startNight(room);
}

const srv=http.createServer((q,r)=>{
 fs.readFile(path.join(__dirname,'public','index.html'),(e,d)=>{if(e){r.writeHead(500);return r.end('Eroare');}r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});r.end(d);});
});
const wss=new WebSocketServer({server:srv});
wss.on('connection',ws=>{
 let room,p;const err=s=>ws.send(JSON.stringify({t:'err',text:s}));
 ws.send(JSON.stringify({t:'hello',R,min:MIN,max:MAX}));
 ws.on('message',raw=>{
  let m;try{m=JSON.parse(raw);}catch{return;}
  if(m.t==='join'||m.t==='create'){
   const name=String(m.name||'').trim().slice(0,16);if(!name)return err('Scrie un nume.');
   let r;
   if(m.t==='create'){let c;do{c=Array.from({length:4},()=>'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random()*24|0]).join('');}while(rooms.has(c));
    r={code:c,ps:[],phase:'lobby',day:0,host:null,end:0};rooms.set(c,r);}
   else r=rooms.get(String(m.room||'').trim().toUpperCase());
   if(!r)return err('Camera nu există. Verifică codul.');
   let q=r.ps.find(x=>x.token===m.token);
   if(q)q.ws=ws;else{
    if(r.phase!=='lobby')return err('Jocul a început deja.');
    if(r.ps.length>=MAX)return err('Camera e plină (20 de jucători).');
    if(r.ps.some(x=>x.name.toLowerCase()===name.toLowerCase()))return err('Numele e deja luat în cameră.');
    q={id:Math.random().toString(36).slice(2,8),token:m.token,name,ws,alive:true,role:null};r.ps.push(q);if(!r.host)r.host=q.id;
    pub(r,`${name} a intrat în cameră.`);
   }
   room=r;p=q;return bc(room);
  }
  if(!room||!p)return;
  const by2=id=>by(room,id);
  switch(m.t){
   case 'start':if(room.host===p.id&&room.phase==='lobby'){if(room.ps.length<MIN)return err(`Sunt necesari minim ${MIN} jucători.`);startGame(room);}break;
   case 'again':if(room.host===p.id&&room.phase==='ended'){room.phase='lobby';room.ps.forEach(x=>{x.role=null;x.team=null;x.alive=true;});bc(room);}break;
   case 'act':{
    if(room.phase!=='night'||!canAct(room,p))break;
    let t=m.target?by2(m.target):null;if(t&&!t.alive)break;
    if(p.role==='veteran')t=m.target?p:null;
    else if(t===p&&p.role!=='doctor')break;
    if(t===p&&p.role==='doctor'&&p.selfHeal<1)break;
    p.act=t?t.id:null;send(p,stateFor(room,p));break;}
   case 'vote':{
    if(room.phase!=='day'||!p.alive)break;
    const t=m.target?by2(m.target):null;if(t&&(!t.alive||t===p))break;
    p.vote=t?t.id:null;bc(room);
    if(room.ps.filter(x=>x.alive).every(x=>x.vote!==undefined))endDay(room);break;}
   case 'reveal':if(room.phase==='day'&&p.alive&&p.role==='primar'&&!p.revealed){p.revealed=true;pub(room,`${p.name} își dezvăluie rolul: Primarul! Votul lui valorează dublu.`);bc(room);}break;
   case 'chat':{
    const text=String(m.text||'').trim().slice(0,200);if(!text)break;
    let ch,f;
    if(room.phase==='lobby'||room.phase==='ended'){ch='all';f=()=>true;}
    else if(!p.alive){ch='dead';f=x=>!x.alive;}
    else if(room.phase==='day'){ch='all';f=()=>true;}
    else if(p.team==='mafia'){ch='mafia';f=x=>x.alive&&x.team==='mafia';}
    else break;
    all(room,{t:'chat',ch,from:p.name,text},f);break;}
  }
 });
 ws.on('close',()=>{
  if(!room||!p)return;p.ws=null;
  if(room.phase==='lobby'){room.ps=room.ps.filter(x=>x!==p);if(room.host===p.id)room.host=room.ps[0]?room.ps[0].id:null;bc(room);}
  if(room.ps.every(x=>!x.ws)){const r=room;setTimeout(()=>{if(r.ps.every(x=>!x.ws)){clearTimeout(r.timer);rooms.delete(r.code);}},600000);}
  else if(room.phase!=='lobby')bc(room);
 });
});
srv.listen(process.env.PORT||3000,()=>console.log('Mafia 20 rulează pe http://localhost:'+(process.env.PORT||3000)));
