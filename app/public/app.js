const configs = {
  members: { title: 'Hội viên', fields: [['full_name','Họ tên','text'],['phone','Số điện thoại','tel'],['email','Email','email'],['registered_at','Ngày đăng ký','date'],['status','Trạng thái','select:active|Tạm ngưng']] },
  plans: { title: 'Gói tập', fields: [['name','Tên gói','text'],['duration_months','Thời hạn (tháng)','number'],['price','Giá tiền','number'],['description','Mô tả','text']] },
  trainers: { title: 'Huấn luyện viên', fields: [['full_name','Họ tên','text'],['specialty','Chuyên môn','text'],['phone','Số điện thoại','tel'],['email','Email','email']] },
  schedules: { title: 'Lịch tập', fields: [['class_name','Tên lớp','text'],['starts_at','Thời gian','datetime-local'],['trainer_id','ID huấn luyện viên','number'],['max_capacity','Sức chứa','number']] },
  member_plans: { title: 'Gói đăng ký', fields: [['member_id','ID Hội viên','number'],['plan_id','ID Gói tập','number'],['starts_at','Ngày bắt đầu','date'],['expires_at','Ngày hết hạn','date']] }
};
let current = 'members', editing = null, token = localStorage.getItem('gym_token'), user = null;
const $ = (s) => document.querySelector(s);
// Dynamic member styles handled in styles.css
const request = (url, options = {}) => fetch(url, { ...options, headers: { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
function showAuthMessage(message = '', type = 'error') { const box = $('#auth-message'); box.textContent = message; box.className = message ? `auth-message ${type}` : 'auth-message'; }
function memberPanels() { const card = $('.member-card'); let grid = $('#member-content-grid'); if (!grid) { grid = document.createElement('div'); grid.id = 'member-content-grid'; grid.className = 'member-content-grid'; card.append(grid); } return grid; }
async function loadMemberChoices() {
  const res = await request('/api/member/catalog'); if (!res.ok) return;
  const data = await res.json(); const grid = memberPanels();
  let form = $('#member-selection');
  if (!form) { form = document.createElement('form'); form.id = 'member-selection'; form.className = 'member-selection'; grid.append(form); } else if (form.parentElement !== grid) grid.append(form);
  form.innerHTML = `<h3>Chọn combo & huấn luyện viên</h3><p class="choice-note">Chọn combo phù hợp với mục tiêu. Giá hiển thị là giá trọn gói.</p><label>Combo / gói tập<select name="plan_id" required>${data.plans.map(p => `<option value="${p.id}" ${String(data.selection.plan_id) === String(p.id) ? 'selected' : ''}>${p.name} — ${Number(p.price).toLocaleString('vi-VN')} đ / ${p.duration_months} tháng</option>`).join('')}</select></label><label>Huấn luyện viên<select name="trainer_id" required>${data.trainers.map(t => `<option value="${t.id}" ${String(data.selection.trainer_id) === String(t.id) ? 'selected' : ''}>${t.full_name} — ${t.specialty}</option>`).join('')}</select></label><button class="primary wide">Lưu lựa chọn của tôi</button><p id="selection-message" role="status"></p>`;
  form.onsubmit = async event => { event.preventDefault(); const response = await request('/api/member/selection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); const result = await response.json(); $('#selection-message').textContent = result.message || result.error || 'Không thể lưu lựa chọn.'; };
}
async function loadCommunity() {
  const response = await request('/api/member/community');
  if (!response.ok) return;
  const data = await response.json(); const grid = memberPanels();
  let section = $('#member-community');
  if (!section) { section = document.createElement('section'); section.id = 'member-community'; section.className = 'member-community'; grid.append(section); } else if (section.parentElement !== grid) grid.append(section);
  section.innerHTML = `<div class="community-head"><div><p class="eyebrow">Cộng đồng GymFit</p><h3>Hội viên đang hoạt động</h3></div><div class="inactive-count"><strong>${data.inactive_count}</strong><span>tạm ngưng</span></div></div><p class="community-note">Hiện có <b>${data.active_count}</b> hội viên hoạt động. Danh sách chỉ hiển thị tên và ngày tham gia.</p><div class="community-list">${data.members.length ? data.members.map(member => `<div class="community-member"><span class="member-dot"></span><div><strong>${member.full_name}</strong><small>Tham gia ${member.registered_at}</small></div><span class="active-badge">Đang hoạt động</span></div>`).join('') : '<p class="community-empty">Hiện chưa có hội viên hoạt động khác.</p>'}</div>`;
  // Community styles handled in styles.css
}
function setAuthMode(mode) { document.querySelectorAll('.auth-tab').forEach(b => b.classList.toggle('active', b.dataset.auth === mode)); $('#login-form').classList.toggle('hidden', mode !== 'login'); $('#otp-form').classList.toggle('hidden', mode !== 'otp'); $('#register-form').classList.toggle('hidden', mode !== 'register'); $('#verify-registration-form')?.classList.toggle('hidden', mode !== 'verify-registration'); showAuthMessage(); }
function finishLogin(data) {
  token = data.token; user = data.user; localStorage.setItem('gym_token', token);
  $('#auth-screen').classList.add('hidden'); $('#app-shell').classList.remove('hidden');
  $('#user-name').textContent = user.full_name; $('#user-role').textContent = user.role.toUpperCase();
  $('#avatar').textContent = user.full_name.charAt(0).toUpperCase();
  const isMember = user.role !== 'admin';
  const path = window.location.pathname;
  if (user.role === 'admin' && !$('#toggle-view-btn')) {
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'toggle-view-btn';
    toggleBtn.className = 'toggle-view-btn';
    toggleBtn.textContent = '👁 Xem giao diện Hội viên';
    toggleBtn.onclick = () => {
      const showingAdmin = !$('#admin-area').classList.contains('hidden');
      $('#admin-area').classList.toggle('hidden', showingAdmin);
      $('#member-area').classList.toggle('hidden', !showingAdmin);
      toggleBtn.textContent = showingAdmin ? '🛠 Bảng Quản trị' : '👁 Xem giao diện Hội viên';
      if (showingAdmin) {
        $('#member-name').textContent = user.full_name;
        $('#member-email').textContent = user.email;
        loadMemberChoices();
        loadCommunity();
      }
    };
    $('.topbar')?.append(toggleBtn);
  }
  if (isMember || path === '/member' || path === '/dashboard') {
    $('.side-nav').classList.add('hidden'); $('#admin-area').classList.add('hidden'); $('#member-area').classList.remove('hidden');
    $('#member-name').textContent = user.full_name; $('#member-email').textContent = user.email;
    loadMemberChoices(); loadCommunity();
  } else {
    $('.side-nav').classList.remove('hidden'); $('#admin-area').classList.remove('hidden'); $('#member-area').classList.add('hidden');
    switchTo(current);
  }
}
async function submitAuth(event, endpoint) { event.preventDefault(); const form = new FormData(event.target); const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(form)) }); const data = await res.json(); if (!res.ok) return showAuthMessage(data.error || 'Không thể thực hiện thao tác.', 'error'); finishLogin(data); }
function input([name,label,type]) { if (type.startsWith('select:')) return `<label>${label}<select name="${name}">${type.slice(7).split('|').map(x=>`<option>${x}</option>`).join('')}</select></label>`; return `<label>${label}<input name="${name}" type="${type}" required></label>`; }
function drawForm(){ const cfg=configs[current]; $('#title').textContent=cfg.title; $('#form').innerHTML=cfg.fields.map(input).join('')+'<button type="submit">'+(editing?'Lưu thay đổi':'Thêm mới')+'</button>'+ (editing?'<button type="button" id="cancel">Hủy</button>':''); if(editing){cfg.fields.forEach(([name])=>{const el=$(`[name=${name}]`); el.value=editing[name]||''}); $('#cancel').onclick=()=>{editing=null;drawForm()};}}
async function load(){ const res=await request(`/api/${current}`); if (!res.ok) return; const rows=await res.json(), cfg=configs[current]; $('#head').innerHTML='<tr>'+cfg.fields.map(([,label])=>`<th>${label}</th>`).join('')+'<th>Thao tác</th></tr>'; $('#body').innerHTML=rows.map(row=>'<tr>'+cfg.fields.map(([name])=>`<td>${row[name]??''}</td>`).join('')+`<td class="actions"><button data-id="${row.id}">Sửa</button> <button data-delete="${row.id}">Xóa</button></td></tr>`).join(''); $('#body').querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>{editing=rows.find(x=>x.id==b.dataset.id);drawForm()}); $('#body').querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(confirm('Xóa bản ghi này?')){await request(`/api/${current}/${b.dataset.delete}`,{method:'DELETE'});load();loadMemberChoices();loadCommunity();}}); }
async function switchTo(name){current=name;editing=null;document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('active',b.dataset.name===name));drawForm();await load();}
Object.entries(configs).forEach(([name,cfg])=>{const b=document.createElement('button');b.textContent=cfg.title;b.dataset.name=name;b.onclick=()=>switchTo(name);$('#tabs').append(b)});
$('#form').onsubmit=async(e)=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));const url=`/api/${current}`+(editing?`/${editing.id}`:'');const res=await request(url,{method:editing?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});$('#message').textContent=res.ok?'Đã lưu dữ liệu.':'Không thể lưu dữ liệu.';if(res.ok){editing=null;drawForm();load();loadMemberChoices();loadCommunity();}};
document.querySelectorAll('.auth-tab').forEach(button => button.onclick = () => setAuthMode(button.dataset.auth));
document.querySelector('.auth-tab[data-auth="otp"]')?.remove();
$('#login-form').onsubmit = event => submitAuth(event, '/api/auth/login');
$('#request-otp').onclick = async () => { const email = $('#otp-email').value.trim(); if (!email) return showAuthMessage('Vui lòng nhập email trước.', 'error'); const res = await fetch('/api/auth/request-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }); const data = await res.json(); showAuthMessage(data.message || data.error || 'Không thể gửi mã.', res.ok ? 'success' : 'error'); };
$('#otp-form').onsubmit = event => submitAuth(event, '/api/auth/verify-otp');
const verifyRegistration = document.createElement('form');
verifyRegistration.id = 'verify-registration-form'; verifyRegistration.className = 'auth-form hidden';
verifyRegistration.innerHTML = '<h2>Bước 2 Xác thực email</h2><p>Mã gồm 6 chữ số đã được gửi đến email của bạn. Nhập mã để hoàn tất đăng ký gói tập.</p><label>Email<input name="email" type="email" required></label><label>Mã xác thực<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="123456" required></label><button class="primary wide">Xác thực và hoàn tất đăng ký</button><button type="button" id="back-to-register">Quay lại đăng ký</button>';
$('#register-form').after(verifyRegistration);
$('#register-form').onsubmit = async event => { event.preventDefault(); const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); const data = await res.json(); if (!res.ok) return showAuthMessage(data.error || 'Không thể gửi mã xác thực.', 'error'); verifyRegistration.email.value = event.target.email.value; verifyRegistration.querySelector('[name=code]').value = data.demo_code || ''; setAuthMode('verify-registration'); showAuthMessage(data.demo_code ? `${data.message} Mã demo của bạn: ${data.demo_code}` : data.message, 'success'); };
verifyRegistration.onsubmit = event => submitAuth(event, '/api/auth/verify-registration');
verifyRegistration.querySelector('#back-to-register').onclick = () => setAuthMode('register');
$('#logout').onclick = () => { localStorage.removeItem('gym_token'); token = null; user = null; $('#app-shell').classList.add('hidden'); $('#auth-screen').classList.remove('hidden'); setAuthMode('login'); };
if (token) request('/api/auth/me').then(async res => { if (res.ok) finishLogin({ token, ...(await res.json()) }); else $('#logout').click(); }).catch(() => $('#logout').click());

