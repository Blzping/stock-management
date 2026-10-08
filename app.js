const root = document.getElementById('app');
const base = window.SUPABASE_URL;
const key = window.SUPABASE_ANON_KEY;
const state = {
  token: null,
  refresh: null,
  user: null,
  page: 'stock',
  products: [],
  suppliers: [],
  movements: [],
  query: '',
  modal: null,
  message: '',
  error: ''
};
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = v => new Intl.NumberFormat('th-TH',{maximumFractionDigits:2}).format(Number(v)||0);
const date = v => new Date(v).toLocaleString('th-TH',{dateStyle:'short',timeStyle:'short'});
const tire = p => `${p.brand} ${p.model} · ${p.size}`;
const formData = f => Object.fromEntries(new FormData(f).entries());
const errorText = e => {
  const m = e.message || String(e);
  return /relation .* does not exist|Could not find the table|schema cache/i.test(m) ? 'ยังไม่พบตารางใน Supabase กรุณาติดตั้ง schema.sql ก่อนใช้งาน' : m;
};
async function api(path, options={}) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${state.token || key}`,
    ...options.headers
  };
  if (options.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}${path}`, { ...options, headers });
  if (!res.ok) {
    let data = {};
    try {
      data = await res.json();
    } catch {}
    throw new Error(data.message || data.error_description || data.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function signIn(email,password){
  const data=await api('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});
  saveSession(data);
  await load();
}

function saveSession(data){
  state.token=data.access_token;
  state.refresh=data.refresh_token;
  state.user=data.user;
  sessionStorage.setItem('tire_session',JSON.stringify({token:state.token,refresh:state.refresh,user:state.user}));
}

async function refreshSession(){
  if(!state.refresh)throw Error('กรุณาเข้าสู่ระบบอีกครั้ง');
  const data=await api('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:state.refresh})});
  saveSession(data)
}

async function load(){
  try {
    const [products,suppliers,movements]=await Promise.all([
      api('/rest/v1/products?select=*&order=brand.asc,model.asc'),
      api('/rest/v1/suppliers?select=*&order=name.asc'),
      api('/rest/v1/movements?select=*&order=created_at.desc&limit=1000')
    ]);
    Object.assign(state,{products,suppliers,movements,error:''});
    render();
  }
  catch(e){
    if(/JWT expired|invalid JWT/i.test(e.message)){
      try{
        await refreshSession();
        return load()
      }
      catch {
        logout();
        return;
      }
    }
    state.error=errorText(e);
    render()
  }
}

function logout(){
  sessionStorage.removeItem('tire_session');
  Object.assign(state,{token:null,refresh:null,user:null,products:[],suppliers:[],movements:[],error:''});
  render()
}

function loginView(){
  root.innerHTML=`<div class="panel login">\
<div class="brand">\
<span class="mark">◉</span> คลังยาง</div>\
<h1>เข้าสู่ระบบ</h1>\
<p class="muted">สำหรับพนักงานภายในร้าน</p>${state.error?`<div class="error">${esc(state.error)}</div>`:''}<form id="login-form">\
<div class="field">\
<label>อีเมล</label>\
<input class="input" name="email" type="email" required autocomplete="username">\
</div>\
<div class="field">\
<label>รหัสผ่าน</label>\
<input class="input" name="password" type="password" required autocomplete="current-password">\
</div>\
<button class="btn primary" style="width:100%;margin-top:12px">เข้าสู่ระบบ</button>\
</form>\
<p class="sub">ให้ผู้ดูแลเพิ่มบัญชีพนักงานใน Supabase Authentication ก่อนใช้งาน</p>\
</div>`;
  document.getElementById('login-form').onsubmit=async e=>{
    e.preventDefault();
    state.error='';
    const b=e.target.querySelector('button');
    b.disabled=true;
    try{
      const d=formData(e.target);
      await signIn(d.email,d.password)
    }
    catch(err){
      state.error=errorText(err);
      render()
    }
    finally{
      b.disabled=false
    }
  }
}

function filteredProducts(){
  const q=state.query.toLowerCase();
  return state.products.filter(p=>`${p.brand} ${p.model} ${p.size} ${p.location||''}`.toLowerCase().includes(q))
}

function pageTitle(){
  return {stock:'สต็อกยาง',products:'ข้อมูลยาง',suppliers:'ซัพพลายเออร์',history:'ประวัติรับเข้า–ขายออก'}[state.page]
}

function render(){
  if(!state.token){
    loginView();
    return
  }
  root.innerHTML=`<div class="shell">\
<aside class="side">\
<div class="brand">\
<span class="mark">◉</span> คลังยาง</div>\
<nav class="nav">${[['stock','สต็อกยาง'],['products','ข้อมูลยาง'],['suppliers','ซัพพลายเออร์'],['history','ประวัติรายการ']].map(([id,label])=>`<button data-page="${id}" class="${state.page===id?'active':''}">${label}</button>`).join('')}</nav>\
<div class="side-foot">${esc(state.user?.email||'')}<br>\
<button class="link" id="logout" style="color:#a9cfff">ออกจากระบบ</button>\
</div>\
</aside>\
<main class="main">\
<div class="top">\
<div>\
<p class="eyebrow">ระบบภายในร้าน</p>\
<h1>${pageTitle()}</h1>\
</div>${['products','history'].includes(state.page)?'<div class="actions">\
<button class="btn" data-modal="in">+ รับยางเข้า</button>\
<button class="btn primary" data-modal="out">ขายยางออก</button>\
</div>':''}</div>${state.error?`<div class="error">${esc(state.error)}</div>`:''}${state.message?`<div class="success">${esc(state.message)}</div>`:''}${pageBody()}</main>\
</div>${state.modal?modalHtml():''}`;
  bind()
}

function pageBody(){
  if(state.page==='stock')return stockView();
  if(state.page==='products')return productView();
  if(state.page==='suppliers')return supplierView();
  return historyView()
}

function stockView(){
  const low=state.products.filter(p=>p.stock_qty<=p.min_qty);
  return `<div class="cards">\
<div class="card">\
<small>รายการยางทั้งหมด</small>\
<strong>${state.products.length}</strong>\
</div>\
<div class="card">\
<small>ยางคงเหลือ</small>\
<strong>${money(state.products.reduce((n,p)=>n+p.stock_qty,0))} เส้น</strong>\
</div>\
<div class="card">\
<small>ใกล้หมด / หมด</small>\
<strong>${low.length} รายการ</strong>\
</div>\
</div>\
<section class="panel">\
<div class="panel-head">\
<h2>ตรวจสอบสต็อก</h2>\
<input id="search" class="input" placeholder="ค้นหา ยี่ห้อ ขนาด รุ่น หรือตำแหน่ง" value="${esc(state.query)}">\
</div>${productTable(filteredProducts(),false)}</section>`
}

function productView(){
  return `<section class="panel">\
<div class="panel-head">\
<h2>รายการยาง</h2>\
<button class="btn primary" data-modal="product">+ เพิ่มยาง</button>\
</div>\
<div class="toolbar" style="margin-bottom:10px">\
<input id="search" class="input" placeholder="ค้นหา ยี่ห้อ ขนาด รุ่น" value="${esc(state.query)}">\
</div>${productTable(filteredProducts(),true)}</section>`
}

function productTable(rows,edit){
  return `<div class="table-wrap">\
<table>\
<thead>\
<tr>\
<th>ยี่ห้อ</th>\
<th>ขนาด</th>\
<th>รุ่นยาง</th>\
<th>ตำแหน่ง</th>\
<th>คงเหลือ</th>\
<th>ขั้นต่ำ</th>\
<th>ราคาขาย</th>${edit?'<th>\
</th>':''}</tr>\
</thead>\
<tbody>${rows.map(p=>`<tr>\
<td>\
<strong>${esc(p.brand)}</strong>\
</td>\
<td>${esc(p.size)}</td>\
<td>${esc(p.model)}</td>\
<td>${esc(p.location||'—')}</td>\
<td>\
<span class="tag ${p.stock_qty<=p.min_qty?'low':''}">${p.stock_qty} เส้น</span>\
</td>\
<td>${p.min_qty}</td>\
<td>฿${money(p.price)}</td>${edit?`<td>\
<button class="link" data-edit-product="${p.id}">แก้ไข</button>\
</td>`:''}</tr>`).join('')}</tbody>\
</table>${rows.length?'':'<div class="empty">ยังไม่มีรายการยาง</div>'}</div>`
}

function supplierView(){
  return `<section class="panel">\
<div class="panel-head">\
<h2>รายชื่อซัพพลายเออร์</h2>\
<button class="btn primary" data-modal="supplier">+ เพิ่มซัพพลายเออร์</button>\
</div>\
<div class="table-wrap">\
<table>\
<thead>\
<tr>\
<th>ชื่อบริษัท / ร้าน</th>\
<th>ผู้ติดต่อ</th>\
<th>เบอร์โทร</th>\
<th>หมายเหตุ</th>\
<th>รับเข้า</th>\
<th>\
</th>\
</tr>\
</thead>\
<tbody>${state.suppliers.map(s=>`<tr>\
<td>\
<strong>${esc(s.name)}</strong>\
</td>\
<td>${esc(s.contact_name||'—')}</td>\
<td>${esc(s.phone||'—')}</td>\
<td>${esc(s.note||'—')}</td>\
<td>${state.movements.filter(m=>m.supplier_id===s.id).length} ครั้ง</td>\
<td>\
<button class="link" data-edit-supplier="${s.id}">แก้ไข</button>\
</td>\
</tr>`).join('')}</tbody>\
</table>${state.suppliers.length?'':'<div class="empty">ยังไม่มีซัพพลายเออร์</div>'}</div>\
</section>`
}

function historyView(){
  const q=state.query.toLowerCase();
  const rows=state.movements.filter(m=>{
    const p=state.products.find(p=>p.id===m.product_id),s=state.suppliers.find(s=>s.id===m.supplier_id);
    return `${p?tire(p):''} ${s?.name||''} ${m.customer_name||''} ${m.doc_ref||''}`.toLowerCase().includes(q)
  }
  );
  return `<section class="panel">\
<div class="panel-head">\
<h2>รับเข้า–ขายออก</h2>\
<input id="search" class="input" placeholder="ค้นหายาง คู่ค้า หรือเลขเอกสาร" value="${esc(state.query)}">\
</div>\
<div class="table-wrap">\
<table>\
<thead>\
<tr>\
<th>วันที่</th>\
<th>ประเภท</th>\
<th>ยี่ห้อ</th>\
<th>ขนาด</th>\
<th>รุ่นยาง</th>\
<th>จำนวน</th>\
<th>จาก / ให้</th>\
<th>ราคา/เส้น</th>\
<th>เลขเอกสาร</th>\
</tr>\
</thead>\
<tbody>${rows.map(m=>{const p=state.products.find(p=>p.id===m.product_id),s=state.suppliers.find(s=>s.id===m.supplier_id);return `<tr>\
<td>${date(m.created_at)}</td>\
<td>\
<span class="tag ${m.kind}">${m.kind==='in'?'รับเข้า':'ขายออก'}</span>\
</td>\
<td>${esc(p?.brand||'—')}</td>\
<td>${esc(p?.size||'—')}</td>\
<td>${esc(p?.model||'—')}</td>\
<td>${m.qty} เส้น</td>\
<td>${esc(m.kind==='in'?s?.name:m.customer_name)}</td>\
<td>฿${money(m.unit_price)}</td>\
<td>${esc(m.doc_ref||'—')}</td>\
</tr>`}).join('')}</tbody>\
</table>${rows.length?'':'<div class="empty">ยังไม่มีประวัติรายการ</div>'}</div>\
</section>`
}

function field(label,name,value='',type='text',extra=''){
  return `<div class="field">\
<label for="f-${name}">${label}</label>\
<input id="f-${name}" class="input" name="${name}" type="${type}" value="${esc(value)}" ${extra}>\
</div>`
}

function catalogField(label, name, values, disabled = false){
  return `<div class="field">
<label for="catalog-${name}">${label}</label>
<select id="catalog-${name}" class="input" data-catalog="${name}" name="${name}" required ${disabled?'disabled':''}>
<option value="" disabled selected hidden>เลือก${label}</option>
${values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('')}
</select>
<button class="link catalog-add" type="button" data-catalog-add="${name}">+ เพิ่ม${label}ใหม่</button>
<div class="catalog-new" data-catalog-new-row="${name}" hidden>
<input class="input" data-catalog-new="${name}" name="${name}_new" placeholder="พิมพ์${label}ใหม่" disabled>
<button class="link" type="button" data-catalog-cancel="${name}">เลือกจากรายการ</button>
</div>
</div>`
}

function uniqueValues(products, selector){
  return [...new Set(products.map(selector).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'th'))
}

function updateCatalogField(form, name, values, disabled = false){
  const select=form.querySelector(`[data-catalog="${name}"]`);
  const newRow=form.querySelector(`[data-catalog-new-row="${name}"]`);
  const input=form.querySelector(`[data-catalog-new="${name}"]`);
  const addButton=form.querySelector(`[data-catalog-add="${name}"]`);
  const label=name==='brand'?'ยี่ห้อ':name==='model'?'รุ่นยาง':'ขนาดยาง';
  select.innerHTML=`<option value="" disabled selected hidden>เลือก${label}</option>${values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('')}`;
  select.hidden=false;
  select.dataset.disabled=String(disabled);
  select.disabled=disabled;
  select.required=!disabled;
  newRow.hidden=true;
  input.required=false;
  input.disabled=true;
  input.value='';
  addButton.hidden=false;
}

function setCatalogNewMode(form, name, enabled){
  const select=form.querySelector(`[data-catalog="${name}"]`);
  const newRow=form.querySelector(`[data-catalog-new-row="${name}"]`);
  const input=form.querySelector(`[data-catalog-new="${name}"]`);
  const addButton=form.querySelector(`[data-catalog-add="${name}"]`);
  select.disabled=enabled||select.dataset.disabled==='true';
  select.hidden=enabled;
  select.required=!select.disabled&&!enabled;
  newRow.hidden=!enabled;
  input.required=enabled;
  input.disabled=!enabled;
  addButton.hidden=enabled;
  if(enabled)input.focus();
  else input.value='';
}

function missingCatalogValue(form){
  for(const [name,label] of [['brand','ยี่ห้อ'],['model','รุ่นยาง'],['size','ขนาดยาง']]){
    const newRow=form.querySelector(`[data-catalog-new-row="${name}"]`);
    const input=form.querySelector(`[data-catalog-new="${name}"]`);
    const select=form.querySelector(`[data-catalog="${name}"]`);
    if(newRow.hidden?!select.value:!input.value.trim())return {name,label};
  }
  return null;
}

function updateModelChoices(form){
  const brand=form.elements.brand.value;
  const brandIsNew=!form.querySelector('[data-catalog-new-row="brand"]').hidden;
  if(brandIsNew){
    updateCatalogField(form,'model',[],true);
    updateCatalogField(form,'size',[],true);
    return;
  }
  if(!brand){
    updateCatalogField(form,'model',[],true);
    updateCatalogField(form,'size',[],true);
    return;
  }
  const models=uniqueValues(state.products.filter(product=>product.brand===brand),product=>product.model);
  updateCatalogField(form,'model',models,models.length===0);
  updateSizeChoices(form);
}

function updateSizeChoices(form){
  const brand=form.elements.brand.value;
  const model=form.elements.model.value;
  const brandIsNew=!form.querySelector('[data-catalog-new-row="brand"]').hidden;
  const modelIsNew=!form.querySelector('[data-catalog-new-row="model"]').hidden;
  if(brandIsNew||modelIsNew){
    updateCatalogField(form,'size',[],true);
    return;
  }
  if(!brand||!model){
    updateCatalogField(form,'size',[],true);
    return;
  }
  const sizes=uniqueValues(state.products.filter(product=>product.brand===brand&&product.model===model),product=>product.size);
  updateCatalogField(form,'size',sizes,sizes.length===0);
}

function modalHtml(){
  const m=state.modal;
  let title='',body='';
  if(m.type==='product'){
    const p=m.id?state.products.find(x=>x.id===m.id):{};
    title=m.id?'แก้ไขข้อมูลยาง':'เพิ่มยาง';
    const tireFields=m.id
      ? `${field('ยี่ห้อ','brand',p.brand,'text','required')}${field('รุ่น / ลายดอก','model',p.model,'text','required')}${field('ขนาดยาง','size',p.size,'text','required')}`
      : `${catalogField('ยี่ห้อ','brand',uniqueValues(state.products,product=>product.brand))}${catalogField('รุ่นยาง','model',[],true)}${catalogField('ขนาดยาง','size',[],true)}`;
    body=`<div class="form-grid">${tireFields}${field('ตำแหน่งจัดเก็บ','location',p.location)}${field('ราคาทุน (บาท)','cost',p.cost,'number','min="0" step="1"', 'required')}${field('ราคาขาย (บาท)','price',p.price,'number','min="0" step="1"' , 'required')}${field('จำนวนขั้นต่ำ','min_qty',p.min_qty,'number','min="0" step="1" ', 'required')}</div>`
  }
  else if(m.type==='supplier'){
    const s=m.id?state.suppliers.find(x=>x.id===m.id):{};
    title=m.id?'แก้ไขซัพพลายเออร์':'เพิ่มซัพพลายเออร์';
    body=`<div class="form-grid">${field('ชื่อบริษัท / ร้าน','name',s.name,'text','required')}${field('ชื่อผู้ติดต่อ','contact_name',s.contact_name)}${field('เบอร์โทร','phone',s.phone,'tel')}${field('หมายเหตุ','note',s.note)}</div>`
  }
  else{
    const isIn=m.type==='in';
    title=isIn?'รับยางเข้าสต็อก':'ขายยางออก';
    body=`<div class="form-grid">\
<div class="field wide">\
<label>ยาง</label>\
<select name="product_id" required>\
<option value="">เลือกยาง</option>${state.products.map(p=>`<option value="${p.id}">${esc(tire(p))} (เหลือ ${p.stock_qty})</option>`).join('')}</select>\
</div>${isIn?`<div class="field wide">\
<label>รับจากซัพพลายเออร์</label>\
<select name="supplier_id" required>\
<option value="">เลือกซัพพลายเออร์</option>${state.suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>\
</div>`:field('ขายให้ลูกค้า','customer_name','','text','required')} ${field('จำนวน (เส้น)','qty','','number','min="1" step="1" required')}${field(isIn?'ราคาทุน/เส้น (บาท)':'ราคาขาย/เส้น (บาท)','unit_price','','number','min="0" step="0.01" required')}${field('เลขที่เอกสาร (ถ้ามี)','doc_ref')}${field('หมายเหตุ (ถ้ามี)','note')}</div>${isIn&&!state.suppliers.length?'<p class="notice">เพิ่มซัพพลายเออร์ก่อนบันทึกรับเข้า</p>':''}`
  }
  return `<div class="modal-back" id="modal-back">\
<div class="modal" role="dialog" aria-modal="true" aria-label="${title}">\
<div class="modal-head">\
<h2>${title}</h2>\
<button class="close" id="close-modal" aria-label="ปิด">×</button>\
</div>\
<form id="data-form">${body}<div class="modal-footer">\
<button type="button" class="btn" id="cancel-modal">ยกเลิก</button>\
<button class="btn primary" ${m.type==='in'&&!state.suppliers.length?'disabled':''}>บันทึก</button>\
</div>\
</form>\
</div>\
</div>`
}

function bind(){
  document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{
    state.page=b.dataset.page;
    state.query='';
    state.message='';
    render()
  }
  );
  document.querySelectorAll('[data-modal]').forEach(b=>b.onclick=()=>{
    state.modal={type:b.dataset.modal};
    render()
  }
  );
  document.querySelectorAll('[data-edit-product]').forEach(b=>b.onclick=()=>{
    state.modal={type:'product',id:Number(b.dataset.editProduct)};
    render()
  }
  );
  document.querySelectorAll('[data-edit-supplier]').forEach(b=>b.onclick=()=>{
    state.modal={type:'supplier',id:Number(b.dataset.editSupplier)};
    render()
  }
  );
  document.getElementById('logout').onclick=logout;
  const search=document.getElementById('search');
  if(search)search.oninput=e=>{
    const pos=e.target.selectionStart;
    state.query=e.target.value;
    render();
    const next=document.getElementById('search');
    next.focus();
    next.setSelectionRange(pos,pos)
  };
  if(state.modal){
    document.getElementById('close-modal').onclick=closeModal;
    document.getElementById('cancel-modal').onclick=closeModal;
    document.getElementById('modal-back').onclick=e=>{
      if(e.target.id==='modal-back')closeModal()
    };
    document.getElementById('data-form').onsubmit=saveForm
    if(state.modal.type==='product'&&!state.modal.id){
      const form=document.getElementById('data-form');
      form.querySelectorAll('[data-catalog]').forEach(select=>select.onchange=()=>{
        if(select.dataset.catalog==='brand')updateModelChoices(form);
        if(select.dataset.catalog==='model')updateSizeChoices(form);
      });
      form.querySelectorAll('[data-catalog-add]').forEach(button=>button.onclick=()=>{
        const name=button.dataset.catalogAdd;
        setCatalogNewMode(form,name,true);
        if(name==='brand')updateModelChoices(form);
        if(name==='model')updateSizeChoices(form);
      });
      form.querySelectorAll('[data-catalog-cancel]').forEach(button=>button.onclick=()=>{
        const name=button.dataset.catalogCancel;
        setCatalogNewMode(form,name,false);
        if(name==='brand')updateModelChoices(form);
        if(name==='model')updateSizeChoices(form);
      });
      updateModelChoices(form);
    }
  }
}

function closeModal(){
  state.modal=null;
  render()
}

async function saveForm(e){
  e.preventDefault();
  const d=formData(e.target),m=state.modal;
  if(m.type==='product'&&!m.id){
    const missing=missingCatalogValue(e.target);
    if(missing){
      const old=e.target.querySelector('.error');
      if(old)old.remove();
      e.target.insertAdjacentHTML('afterbegin',`<div class="error">เลือก${missing.label} หรือกด “เพิ่ม${missing.label}ใหม่” ก่อนบันทึก</div>`);
      e.target.querySelector(`[data-catalog-add="${missing.name}"]`).focus();
      return;
    }
  }
  const button=e.target.querySelector('button[type=submit],button.btn.primary');
  button.disabled=true;
  try{
    if(m.type==='product'){
      const catalogValue=name=>d[`${name}_new`]!==undefined?d[`${name}_new`].trim():d[name].trim();
      const data={brand:catalogValue('brand'),model:catalogValue('model'),size:catalogValue('size').toUpperCase(),location:d.location.trim()||null,cost:Number(d.cost),price:Number(d.price),min_qty:Number(d.min_qty)};
      await api(`/rest/v1/products${m.id?`?id=eq.${m.id}`:''}`,{method:m.id?'PATCH':'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(data)})
    }
    else if(m.type==='supplier'){
      const data={name:d.name.trim(),contact_name:d.contact_name.trim()||null,phone:d.phone.trim()||null,note:d.note.trim()||null};
      await api(`/rest/v1/suppliers${m.id?`?id=eq.${m.id}`:''}`,{method:m.id?'PATCH':'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify(data)})
    }
    else{
      const data={p_product_id:Number(d.product_id),p_kind:m.type,p_qty:Number(d.qty),p_supplier_id:m.type==='in'?Number(d.supplier_id):null,p_customer_name:m.type==='out'?d.customer_name.trim():null,p_unit_price:Number(d.unit_price),p_doc_ref:d.doc_ref.trim()||null,p_note:d.note.trim()||null};
      await api('/rest/v1/rpc/record_movement',{method:'POST',body:JSON.stringify(data)})
    }
    state.modal=null;
    state.message='บันทึกข้อมูลเรียบร้อย';
    await load()
  }
  catch(err){
    const old=e.target.querySelector('.error');
    if(old)old.remove();
    e.target.insertAdjacentHTML('afterbegin',`<div class="error">${esc(errorText(err))}</div>`);
    button.disabled=false
  }
}
try{
  const s=JSON.parse(sessionStorage.getItem('tire_session')||'null');
  if(s)Object.assign(state,s)
}
catch {}
render();
if(state.token)load();
