/* ═══════════════════════════════════════════════════════════════════════════
   ADS GESTÃO — MÓDULO DE SEGURANÇA v1.0
   Arquitetura inspirada em Nubank / Mercado Pago / apps bancários modernos

   FLUXO GERAL:
   ┌─ Abertura do app ──────────────────────────────────────────────────────┐
   │  1. Tela de login normal (usuário + senha) — APENAS NA PRIMEIRA VEZ    │
   │  2. Após login → biometria registrada / PIN configurado                │
   │  3. Próximas aberturas → somente biometria / PIN (sem digitar senha)   │
   └────────────────────────────────────────────────────────────────────────┘
   ┌─ Durante o uso ────────────────────────────────────────────────────────┐
   │  • Volta do background → solicita biometria / PIN                      │
   │  • X min sem interação → tela de bloqueio biométrico                   │
   │  • Módulo Financeiro  → camada extra (biometria ou senha)              │
   └────────────────────────────────────────────────────────────────────────┘
   DETECÇÃO DE PLATAFORMA:
   • Mobile  (Android/iOS PWA) → Web Authentication API (biometria real)    │
   • Web     (desktop/tablet)  → PIN numérico ou senha do usuário           │
   ═══════════════════════════════════════════════════════════════════════════ */

(function(global) {
  'use strict';

  // ─── CONFIGURAÇÕES ────────────────────────────────────────────────────────
  var SEC_CONFIG = {
    INACTIVITY_TIMEOUT_MS : 5 * 60 * 1000,   // 5 minutos de inatividade
    LS_KEY_SESSION        : 'ads_sec_session', // chave localStorage da sessão
    LS_KEY_BIO_REG        : 'ads_bio_registered', // flag biometria registrada
    LS_KEY_PIN            : 'ads_sec_pin',    // PIN hasheado (simples)
    SENSITIVE_MODULES     : ['financeiro', 'relatorios'], // módulos com camada extra
    UNLOCK_GRACE_MS       : 30 * 1000,        // 30s de graça ao voltar do bg
  };

  // ─── ESTADO INTERNO ───────────────────────────────────────────────────────
  var SEC = {
    currentUser     : null,   // objeto do usuário logado
    sessionActive   : false,  // sessão autenticada?
    bioSupported    : false,   // Web Authn disponível?
    isMobile        : false,  // dispositivo móvel?
    inactivityTimer : null,   // timer de inatividade
    bgHideTime      : null,   // quando o app foi para o background
    sensitiveUnlocked: false, // módulo sensível já desbloqueado nesta sessão
    pendingSensitiveCb: null, // callback após autenticação de área sensível
    credentialId    : null,   // id da credencial WebAuthn registrada
  };

  // ─── DETECÇÃO DE PLATAFORMA ───────────────────────────────────────────────
  function detectPlatform() {
    var ua = navigator.userAgent || '';
    SEC.isMobile = /Android|iPhone|iPad|iPod/i.test(ua) ||
                   (navigator.maxTouchPoints > 1 && /Mac/.test(ua)); // iPad Pro
    SEC.bioSupported = !!(
      SEC.isMobile &&
      window.PublicKeyCredential &&
      typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
    );
  }

  // ─── HASH SIMPLES (PIN) — NÃO criptografia real ──────────────────────────
  // Para produção: use bcrypt via WebCrypto. Aqui usamos SHA-256 nativo.
  async function hashPin(pin) {
    var enc = new TextEncoder();
    var data = enc.encode('ads_salt_2024_' + pin);
    var hashBuffer = await crypto.subtle.digest('SHA-256', data);
    var hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(function(b){ return b.toString(16).padStart(2,'0'); }).join('');
  }

  // ─── WEB AUTHN: REGISTRAR BIOMETRIA ──────────────────────────────────────
  async function registrarBiometria(userId) {
    if (!SEC.bioSupported) return false;
    try {
      var challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      var cred = await navigator.credentials.create({
        publicKey: {
          challenge   : challenge,
          rp          : { name: 'ADS Gestão', id: location.hostname || 'localhost' },
          user        : {
            id          : new TextEncoder().encode(userId),
            name        : userId,
            displayName : userId,
          },
          pubKeyCredParams : [{ alg: -7, type: 'public-key' }],
          authenticatorSelection: {
            authenticatorAttachment : 'platform',  // biometria do PRÓPRIO dispositivo
            userVerification        : 'required',  // obrigatório: face/digital/PIN nativo
            residentKey             : 'preferred',
          },
          timeout: 60000,
        },
      });
      // Salva apenas o ID da credencial (não a chave pública — simplificação client-side)
      localStorage.setItem('ads_cred_id', _bufToB64(cred.rawId));
      localStorage.setItem(SEC_CONFIG.LS_KEY_BIO_REG, '1');
      SEC.credentialId = cred.rawId;
      return true;
    } catch (e) {
      console.warn('[SEC] Biometria não registrada:', e.name || e);
      return false;
    }
  }

  // ─── WEB AUTHN: VERIFICAR BIOMETRIA ──────────────────────────────────────
  async function verificarBiometria() {
    if (!SEC.bioSupported) return false;
    try {
      var credIdB64 = localStorage.getItem('ads_cred_id');
      var challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);
      var opts = {
        challenge   : challenge,
        rpId        : location.hostname || 'localhost',
        userVerification: 'required',
        timeout     : 60000,
      };
      if (credIdB64) {
        opts.allowCredentials = [{
          id   : _b64ToBuf(credIdB64),
          type : 'public-key',
          transports: ['internal'],
        }];
      }
      await navigator.credentials.get({ publicKey: opts });
      return true;
    } catch (e) {
      console.warn('[SEC] Verificação biométrica falhou:', e.name || e);
      return false;
    }
  }

  // ─── UTILITÁRIOS BASE64 ↔ ArrayBuffer ─────────────────────────────────────
  function _bufToB64(buf) {
    return btoa(String.fromCharCode.apply(null, new Uint8Array(buf)));
  }
  function _b64ToBuf(b64) {
    var bin = atob(b64);
    var buf = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return buf.buffer;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TELAS DE SEGURANÇA — geração de HTML
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── CSS DA CAMADA DE SEGURANÇA ───────────────────────────────────────────
  function _injectCSS() {
    if (document.getElementById('ads-sec-styles')) return;
    var s = document.createElement('style');
    s.id = 'ads-sec-styles';
    s.textContent = `
/* ═══ ADS SECURITY LAYER ════════════════════════════════════════════════ */
#ads-lock-overlay{
  position:fixed;inset:0;background:var(--bg,#08111f);z-index:10000;
  display:flex;align-items:center;justify-content:center;
  animation:secFadeIn .25s ease;
}
#ads-lock-overlay.hide{
  animation:secFadeOut .2s ease forwards;
  pointer-events:none;
}
@keyframes secFadeIn{from{opacity:0;transform:scale(1.03)}to{opacity:1;transform:scale(1)}}
@keyframes secFadeOut{to{opacity:0;transform:scale(.97)}}

.sec-box{
  background:var(--bg2,#0c1a2e);
  border:1px solid rgba(59,130,246,.25);
  border-radius:20px;
  padding:36px 32px 28px;
  width:320px;
  max-width:92vw;
  text-align:center;
  box-shadow:0 20px 60px rgba(0,0,0,.6);
}
.sec-app-icon{
  width:64px;height:64px;
  background:var(--blue,#2563eb);
  border-radius:16px;
  display:flex;align-items:center;justify-content:center;
  font-weight:900;font-size:18px;
  margin:0 auto 14px;
  border:1px solid rgba(59,130,246,.4);
  box-shadow:0 0 30px rgba(37,99,235,.3);
}
.sec-title{font-size:18px;font-weight:800;color:var(--white,#e8f0ff);margin-bottom:4px}
.sec-sub{font-size:11px;color:var(--silver,#7a8fa8);margin-bottom:26px;letter-spacing:.5px}
.sec-user-badge{
  display:inline-flex;align-items:center;gap:8px;
  background:rgba(37,99,235,.1);border:1px solid rgba(59,130,246,.2);
  border-radius:24px;padding:5px 12px 5px 6px;
  margin-bottom:24px;
}
.sec-user-av{
  width:28px;height:28px;border-radius:50%;
  background:var(--blue,#2563eb);
  display:flex;align-items:center;justify-content:center;
  font-size:10px;font-weight:700;color:#fff;flex-shrink:0;
}
.sec-user-nm{font-size:12px;font-weight:700;color:var(--white,#e8f0ff)}

/* BOTÃO BIOMÉTRICO */
.sec-bio-btn{
  width:80px;height:80px;border-radius:50%;
  background:rgba(37,99,235,.12);
  border:2px solid rgba(59,130,246,.35);
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:4px;cursor:pointer;margin:0 auto 20px;
  transition:all .18s;font-size:30px;
  box-shadow:0 0 0 0 rgba(37,99,235,.4);
  animation:bioPulse 2.2s ease-in-out infinite;
}
.sec-bio-btn:hover{
  background:rgba(37,99,235,.22);
  border-color:rgba(59,130,246,.7);
  transform:scale(1.06);
  animation:none;
}
@keyframes bioPulse{
  0%,100%{box-shadow:0 0 0 0 rgba(37,99,235,.4)}
  50%{box-shadow:0 0 0 12px rgba(37,99,235,0)}
}
.sec-bio-label{font-size:10px;color:var(--blue3,#60a5fa);font-weight:700;letter-spacing:.5px;text-transform:uppercase;margin-top:2px}

/* PIN */
.sec-pin-display{
  display:flex;gap:12px;justify-content:center;margin:0 auto 22px;
}
.sec-pin-dot{
  width:14px;height:14px;border-radius:50%;
  background:rgba(59,130,246,.2);
  border:2px solid rgba(59,130,246,.4);
  transition:all .15s;
}
.sec-pin-dot.filled{background:var(--blue,#2563eb);border-color:var(--blue2,#3b82f6);}
.sec-pin-dot.error{background:var(--red,#ef4444);border-color:#ef4444;animation:dotShake .3s}
@keyframes dotShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}

.sec-numpad{
  display:grid;grid-template-columns:repeat(3,1fr);gap:9px;max-width:220px;margin:0 auto 16px;
}
.sec-num-btn{
  background:rgba(59,130,246,.07);
  border:1px solid rgba(59,130,246,.15);
  border-radius:12px;padding:14px 0;
  font-size:18px;font-weight:700;color:var(--white,#e8f0ff);
  cursor:pointer;transition:all .12s;font-family:inherit;
  user-select:none;-webkit-tap-highlight-color:transparent;
}
.sec-num-btn:hover,.sec-num-btn:active{
  background:rgba(37,99,235,.25);
  border-color:rgba(59,130,246,.5);
  transform:scale(.96);
}
.sec-num-btn.del{font-size:16px;color:var(--silver,#7a8fa8);}
.sec-num-btn.empty{background:transparent;border-color:transparent;cursor:default;}

/* CAMPO SENHA (fallback web) */
.sec-pass-field{
  width:100%;background:var(--bg3,#101f38);
  border:1px solid rgba(59,130,246,.3);
  border-radius:9px;padding:11px 14px;
  color:var(--white,#e8f0ff);font-size:15px;
  font-family:inherit;text-align:center;letter-spacing:4px;
  margin-bottom:12px;outline:none;box-sizing:border-box;
}
.sec-pass-field:focus{border-color:var(--blue2,#3b82f6);}
.sec-pass-field.error{border-color:var(--red,#ef4444);animation:dotShake .3s}

/* BOTÕES SECUNDÁRIOS */
.sec-link-btn{
  background:none;border:none;color:var(--silver,#7a8fa8);
  font-size:11px;cursor:pointer;font-family:inherit;
  padding:4px 8px;border-radius:6px;transition:color .12s;
  text-decoration:underline;text-underline-offset:2px;
}
.sec-link-btn:hover{color:var(--blue3,#60a5fa);}

.sec-confirm-btn{
  width:100%;background:var(--blue,#2563eb);color:#fff;
  border:none;border-radius:9px;padding:12px;
  font-size:14px;font-weight:700;cursor:pointer;
  font-family:inherit;margin-top:4px;transition:.12s;
}
.sec-confirm-btn:hover{background:var(--blue2,#3b82f6);}

.sec-err-msg{
  color:var(--red,#ef4444);font-size:11px;
  margin-top:8px;min-height:16px;font-weight:600;
}

/* SETUP PIN */
.sec-setup-step{font-size:11px;color:var(--silver,#7a8fa8);margin-bottom:8px}

/* MODAL ÁREA SENSÍVEL */
#ads-sensitive-overlay{
  position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:10001;
  display:flex;align-items:center;justify-content:center;
  animation:secFadeIn .2s ease;
}
#ads-sensitive-overlay .sec-box{
  border-color:rgba(245,158,11,.3);
}
.sec-sensitive-icon{font-size:36px;margin-bottom:10px}
.sec-sensitive-warning{
  background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);
  border-radius:8px;padding:9px 12px;font-size:11px;color:var(--amber,#f59e0b);
  margin-bottom:20px;
}

/* STATUS INDICATOR */
.sec-status-dot{
  display:inline-block;width:7px;height:7px;
  border-radius:50%;margin-right:5px;vertical-align:middle;
}
.sec-status-dot.locked{background:var(--red,#ef4444);}
.sec-status-dot.unlocked{background:var(--green,#10b981);}

/* TOASTS */
.sec-toast{
  position:fixed;bottom:80px;left:50%;transform:translateX(-50%);
  background:rgba(15,30,53,.97);border:1px solid rgba(59,130,246,.3);
  border-radius:10px;padding:11px 18px;font-size:12px;font-weight:700;
  color:var(--white,#e8f0ff);z-index:11000;
  box-shadow:0 4px 20px rgba(0,0,0,.5);
  animation:secFadeIn .2s ease;white-space:nowrap;
}
.sec-toast.success{border-color:rgba(16,185,129,.4);color:var(--green2,#34d399);}
.sec-toast.error{border-color:rgba(239,68,68,.4);color:var(--red,#ef4444);}

@media(max-width:700px){
  .sec-box{padding:30px 20px 22px;border-radius:16px;}
  .sec-bio-btn{width:90px;height:90px;font-size:34px;}
}
/* ═══════════════════════════════════════════════════════════════════════ */`;
    document.head.appendChild(s);
  }

  // ─── OVERLAY PRINCIPAL (tela de bloqueio) ─────────────────────────────────
  function _buildLockOverlay() {
    var existing = document.getElementById('ads-lock-overlay');
    if (existing) existing.remove();

    var bio_registered = !!localStorage.getItem(SEC_CONFIG.LS_KEY_BIO_REG);
    var pin_set        = !!localStorage.getItem(SEC_CONFIG.LS_KEY_PIN);
    var nome = SEC.currentUser ? SEC.currentUser.nome : '';
    var avatar = SEC.currentUser ? SEC.currentUser.avatar : '?';

    var el = document.createElement('div');
    el.id = 'ads-lock-overlay';
    el.innerHTML = _lockHTML(nome, avatar, bio_registered, pin_set, false);
    document.body.appendChild(el);
    _bindLockEvents(false);
  }

  // ─── HTML DA TELA DE BLOQUEIO ─────────────────────────────────────────────
  function _lockHTML(nome, avatar, showBio, showPin, isSensitive) {
    var title = isSensitive
      ? 'Área Protegida'
      : 'ADS Gestão';
    var sub = isSensitive
      ? 'Confirme sua identidade para continuar'
      : 'Confirme para continuar usando o app';

    // Decide o que mostrar baseado em plataforma e configuração
    var mainContent = '';

    if (SEC.isMobile && showBio) {
      // Biometria disponível → mostra botão biométrico
      mainContent = `
        <button class="sec-bio-btn" id="sec-bio-btn" title="Usar biometria">
          <span>` + (SEC.bioSupported ? '🔏' : '👆') + `</span>
        </button>
        <div style="font-size:12px;color:var(--silver,#7a8fa8);margin-bottom:16px">
          Toque para autenticar com<br><strong style="color:var(--blue3,#60a5fa)">
          Face ID / Digital</strong>
        </div>
        <div style="border-top:1px solid rgba(59,130,246,.1);padding-top:14px;margin-top:4px">
          <button class="sec-link-btn" id="sec-use-pin-btn">
            🔢 Usar PIN em vez disso
          </button>
        </div>`;
    } else if (showPin) {
      // PIN disponível
      mainContent = _pinHTML();
    } else {
      // Senha normal (web desktop ou configuração inicial)
      mainContent = _passwordHTML(isSensitive);
    }

    return `
      <div class="sec-box">
        <div class="sec-app-icon">ADS</div>
        <div class="sec-title">` + title + `</div>
        <div class="sec-sub">` + sub + `</div>
        ` + (nome ? `<div class="sec-user-badge">
          <div class="sec-user-av">` + avatar + `</div>
          <div class="sec-user-nm">` + nome + `</div>
        </div>` : '') + `
        <div id="sec-main-content">
          ` + mainContent + `
        </div>
        <div class="sec-err-msg" id="sec-err-msg"></div>
      </div>`;
  }

  // ─── HTML DO NUMPAD DE PIN ────────────────────────────────────────────────
  function _pinHTML(isSetup, step) {
    var label = isSetup
      ? (step === 2 ? 'Confirme o PIN' : 'Crie um PIN de 6 dígitos')
      : 'Digite seu PIN';
    return `
      <div class="sec-setup-step">` + label + `</div>
      <div class="sec-pin-display" id="sec-pin-display">
        ` + [1,2,3,4,5,6].map(function(){ return '<div class="sec-pin-dot"></div>'; }).join('') + `
      </div>
      <div class="sec-numpad" id="sec-numpad">
        ` + [1,2,3,4,5,6,7,8,9].map(function(n){
          return '<button class="sec-num-btn" data-n="' + n + '">' + n + '</button>';
        }).join('') + `
        <button class="sec-num-btn empty"></button>
        <button class="sec-num-btn" data-n="0">0</button>
        <button class="sec-num-btn del" id="sec-pin-del">⌫</button>
      </div>
      ` + (!isSetup ? `
      <button class="sec-link-btn" id="sec-use-pass-btn">
        🔑 Usar senha do app
      </button>` : '');
  }

  // ─── HTML DA TELA DE SENHA ────────────────────────────────────────────────
  function _passwordHTML(isSensitive) {
    return `
      <div style="font-size:12px;color:var(--silver,#7a8fa8);margin-bottom:12px">
        ` + (isSensitive
          ? 'Digite sua senha para acessar esta área'
          : 'Digite sua senha para desbloquear') + `
      </div>
      <input type="password" class="sec-pass-field" id="sec-pass-input"
        placeholder="••••••••" autocomplete="current-password"
        maxlength="40"/>
      <button class="sec-confirm-btn" id="sec-pass-confirm-btn">
        🔓 Confirmar
      </button>`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENTOS — tela de bloqueio principal
  // ═══════════════════════════════════════════════════════════════════════════
  var _pinBuffer = '';

  function _bindLockEvents(isSensitive, onSuccess) {
    var overlay = document.getElementById(isSensitive ? 'ads-sensitive-overlay' : 'ads-lock-overlay');
    if (!overlay) return;

    // Botão biométrico
    var bioBtn = overlay.querySelector('#sec-bio-btn');
    if (bioBtn) {
      bioBtn.addEventListener('click', function() {
        _tryBiometricUnlock(isSensitive, onSuccess);
      });
      // Auto-dispara biometria ao abrir (melhor UX — como Nubank)
      setTimeout(function() {
        _tryBiometricUnlock(isSensitive, onSuccess);
      }, 400);
    }

    // Alterna para PIN
    var usePinBtn = overlay.querySelector('#sec-use-pin-btn');
    if (usePinBtn) {
      usePinBtn.addEventListener('click', function() {
        var content = overlay.querySelector('#sec-main-content');
        if (content) { content.innerHTML = _pinHTML(); _bindPinEvents(overlay, isSensitive, onSuccess); }
      });
    }

    // PIN já visível
    _bindPinEvents(overlay, isSensitive, onSuccess);

    // Senha
    var passInput = overlay.querySelector('#sec-pass-input');
    var passBtn   = overlay.querySelector('#sec-pass-confirm-btn');
    if (passInput) {
      passInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') _tryPasswordUnlock(overlay, isSensitive, onSuccess);
      });
      setTimeout(function() { passInput.focus(); }, 300);
    }
    if (passBtn) {
      passBtn.addEventListener('click', function() {
        _tryPasswordUnlock(overlay, isSensitive, onSuccess);
      });
    }

    // Alterna para senha
    var usePassBtn = overlay.querySelector('#sec-use-pass-btn');
    if (usePassBtn) {
      usePassBtn.addEventListener('click', function() {
        var content = overlay.querySelector('#sec-main-content');
        if (content) { content.innerHTML = _passwordHTML(isSensitive); _bindLockEvents(isSensitive, onSuccess); }
      });
    }
  }

  // ─── EVENTOS DO NUMPAD ────────────────────────────────────────────────────
  function _bindPinEvents(overlay, isSensitive, onSuccess) {
    _pinBuffer = '';
    var numpad = overlay.querySelector('#sec-numpad');
    if (!numpad) return;

    numpad.addEventListener('click', function(e) {
      var btn = e.target.closest('[data-n]');
      var del = e.target.closest('#sec-pin-del');
      if (del) {
        _pinBuffer = _pinBuffer.slice(0, -1);
        _updatePinDots(overlay);
        return;
      }
      if (!btn) return;
      if (_pinBuffer.length >= 6) return;
      _pinBuffer += btn.getAttribute('data-n');
      _updatePinDots(overlay);
      if (_pinBuffer.length === 6) {
        setTimeout(function() { _tryPinUnlock(overlay, isSensitive, onSuccess); }, 100);
      }
    });
  }

  function _updatePinDots(overlay) {
    var dots = overlay.querySelectorAll('.sec-pin-dot');
    dots.forEach(function(dot, i) {
      dot.classList.toggle('filled', i < _pinBuffer.length);
      dot.classList.remove('error');
    });
  }

  function _pinError(overlay) {
    _pinBuffer = '';
    var dots = overlay.querySelectorAll('.sec-pin-dot');
    dots.forEach(function(d) { d.classList.add('error'); d.classList.remove('filled'); });
    setTimeout(function() { dots.forEach(function(d){ d.classList.remove('error'); }); }, 500);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TENTATIVAS DE DESBLOQUEIO
  // ═══════════════════════════════════════════════════════════════════════════

  async function _tryBiometricUnlock(isSensitive, onSuccess) {
    var overlay = document.getElementById(isSensitive ? 'ads-sensitive-overlay' : 'ads-lock-overlay');
    var err = overlay ? overlay.querySelector('#sec-err-msg') : null;
    var bioBtn = overlay ? overlay.querySelector('#sec-bio-btn') : null;
    if (bioBtn) { bioBtn.style.opacity = '0.5'; bioBtn.style.pointerEvents = 'none'; }

    var ok = await verificarBiometria();
    if (bioBtn) { bioBtn.style.opacity = '1'; bioBtn.style.pointerEvents = 'auto'; }

    if (ok) {
      _onUnlockSuccess(isSensitive, onSuccess);
    } else {
      if (err) err.textContent = 'Biometria não reconhecida. Tente novamente.';
    }
  }

  async function _tryPinUnlock(overlay, isSensitive, onSuccess) {
    var storedHash = localStorage.getItem(SEC_CONFIG.LS_KEY_PIN);
    if (!storedHash) { _showErr(overlay, 'PIN não configurado.'); return; }
    var hash = await hashPin(_pinBuffer);
    if (hash === storedHash) {
      _onUnlockSuccess(isSensitive, onSuccess);
    } else {
      _pinError(overlay);
      _showErr(overlay, 'PIN incorreto. Tente novamente.');
    }
  }

  function _tryPasswordUnlock(overlay, isSensitive, onSuccess) {
    var input = overlay.querySelector('#sec-pass-input');
    if (!input) return;
    var val = input.value;
    if (!val) { _showErr(overlay, 'Digite sua senha.'); return; }

    // Verifica contra usuários carregados (array global USUARIOS do sistema)
    var found = null;
    if (global.USUARIOS && global.USUARIOS.length) {
      if (SEC.currentUser) {
        found = global.USUARIOS.find(function(u) {
          return u.user === SEC.currentUser.user && u.pass === val;
        });
      } else {
        found = global.USUARIOS.find(function(u) { return u.pass === val; });
      }
    }
    if (found) {
      if (!SEC.currentUser) SEC.currentUser = found;
      _onUnlockSuccess(isSensitive, onSuccess);
    } else {
      input.classList.add('error');
      input.value = '';
      setTimeout(function() { input.classList.remove('error'); input.focus(); }, 400);
      _showErr(overlay, 'Senha incorreta.');
    }
  }

  function _showErr(overlay, msg) {
    var el = overlay ? overlay.querySelector('#sec-err-msg') : null;
    if (el) el.textContent = msg;
  }

  // ─── SUCESSO NO DESBLOQUEIO ───────────────────────────────────────────────
  function _onUnlockSuccess(isSensitive, onSuccess) {
    if (isSensitive) {
      SEC.sensitiveUnlocked = true;
      var ov = document.getElementById('ads-sensitive-overlay');
      if (ov) {
        ov.classList.add('hide');
        setTimeout(function() { ov.remove(); }, 200);
      }
      _secToast('✅ Acesso autorizado', 'success');
      if (typeof onSuccess === 'function') onSuccess();
    } else {
      SEC.sessionActive = true;
      var ov2 = document.getElementById('ads-lock-overlay');
      if (ov2) {
        ov2.classList.add('hide');
        setTimeout(function() { ov2.remove(); }, 250);
      }
      _startInactivityTimer();
      _secToast('✅ Identificado com sucesso', 'success');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIGURAÇÃO DE PIN (primeiro acesso)
  // ═══════════════════════════════════════════════════════════════════════════
  async function _setupPin(onDone) {
    var step = 1;
    var firstPin = '';

    var overlay = document.createElement('div');
    overlay.id = 'ads-lock-overlay';
    overlay.innerHTML = `
      <div class="sec-box">
        <div class="sec-app-icon">ADS</div>
        <div class="sec-title">Configurar PIN</div>
        <div class="sec-sub">Este PIN será usado para desbloquear o app</div>
        <div id="sec-main-content">` + _pinHTML(true, 1) + `</div>
        <div class="sec-err-msg" id="sec-err-msg"></div>
      </div>`;
    document.body.appendChild(overlay);
    _pinBuffer = '';

    var numpad = overlay.querySelector('#sec-numpad');
    numpad.addEventListener('click', async function(e) {
      var btn = e.target.closest('[data-n]');
      var del = e.target.closest('#sec-pin-del');
      if (del) { _pinBuffer = _pinBuffer.slice(0, -1); _updatePinDots(overlay); return; }
      if (!btn) return;
      if (_pinBuffer.length >= 6) return;
      _pinBuffer += btn.getAttribute('data-n');
      _updatePinDots(overlay);

      if (_pinBuffer.length === 6) {
        if (step === 1) {
          firstPin = _pinBuffer;
          step = 2;
          _pinBuffer = '';
          var content = overlay.querySelector('#sec-main-content');
          content.innerHTML = _pinHTML(true, 2);
          _updatePinDots(overlay);
          // rebind no mesmo numpad
          var np2 = overlay.querySelector('#sec-numpad');
          // delegação já está no mesmo numpad clonado
        } else {
          if (_pinBuffer === firstPin) {
            var hash = await hashPin(_pinBuffer);
            localStorage.setItem(SEC_CONFIG.LS_KEY_PIN, hash);
            overlay.classList.add('hide');
            setTimeout(function() { overlay.remove(); }, 200);
            _secToast('🔐 PIN configurado!', 'success');
            if (typeof onDone === 'function') onDone();
          } else {
            _pinError(overlay);
            _showErr(overlay, 'PINs não coincidem. Tente novamente.');
            step = 1;
            firstPin = '';
            setTimeout(function() {
              var content = overlay.querySelector('#sec-main-content');
              if (content) content.innerHTML = _pinHTML(true, 1);
              _pinBuffer = '';
            }, 600);
          }
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TIMER DE INATIVIDADE
  // ═══════════════════════════════════════════════════════════════════════════
  function _startInactivityTimer() {
    _clearInactivityTimer();
    SEC.inactivityTimer = setTimeout(function() {
      _lockApp('inactivity');
    }, SEC_CONFIG.INACTIVITY_TIMEOUT_MS);
  }

  function _clearInactivityTimer() {
    if (SEC.inactivityTimer) { clearTimeout(SEC.inactivityTimer); SEC.inactivityTimer = null; }
  }

  function _resetInactivityTimer() {
    if (!SEC.sessionActive) return;
    _startInactivityTimer();
  }

  // ─── EVENTOS QUE RESETAM INATIVIDADE ─────────────────────────────────────
  var _ACTIVITY_EVENTS = ['mousedown','mousemove','keydown','touchstart','scroll','click'];
  var _activityHandler = _debounce(_resetInactivityTimer, 1000);

  function _attachActivityListeners() {
    _ACTIVITY_EVENTS.forEach(function(ev) {
      document.addEventListener(ev, _activityHandler, { passive: true });
    });
  }

  function _debounce(fn, ms) {
    var t; return function() { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  // ─── VISIBILIDADE (volta do background) ──────────────────────────────────
  function _attachVisibilityListener() {
    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        SEC.bgHideTime = Date.now();
      } else {
        if (!SEC.sessionActive) return;
        var elapsed = Date.now() - (SEC.bgHideTime || 0);
        // Só bloqueia se ficou em background por mais de 30s
        if (elapsed > SEC_CONFIG.UNLOCK_GRACE_MS) {
          _lockApp('background');
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BLOQUEIO DO APP
  // ═══════════════════════════════════════════════════════════════════════════
  function _lockApp(reason) {
    SEC.sessionActive    = false;
    SEC.sensitiveUnlocked = false;
    _clearInactivityTimer();
    console.info('[SEC] App bloqueado. Motivo:', reason);
    _buildLockOverlay();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROTEÇÃO DE ÁREA SENSÍVEL (módulo Financeiro etc.)
  // ═══════════════════════════════════════════════════════════════════════════
  function _showSensitiveGate(moduleName, onSuccess) {
    // Não pede novamente se já autenticou na mesma sessão de uso
    if (SEC.sensitiveUnlocked) { if (typeof onSuccess === 'function') onSuccess(); return; }

    var existing = document.getElementById('ads-sensitive-overlay');
    if (existing) existing.remove();

    var bio_registered = !!localStorage.getItem(SEC_CONFIG.LS_KEY_BIO_REG);
    var pin_set        = !!localStorage.getItem(SEC_CONFIG.LS_KEY_PIN);
    var nome  = SEC.currentUser ? SEC.currentUser.nome : '';
    var avatar = SEC.currentUser ? SEC.currentUser.avatar : '?';

    var overlay = document.createElement('div');
    overlay.id = 'ads-sensitive-overlay';

    var mainContent = '';
    if (SEC.isMobile && bio_registered) {
      mainContent = `
        <button class="sec-bio-btn" id="sec-bio-btn">🔏</button>
        <div style="font-size:12px;color:var(--silver,#7a8fa8);margin-bottom:14px">
          Autentique com <strong style="color:var(--blue3,#60a5fa)">biometria</strong>
        </div>
        <button class="sec-link-btn" id="sec-use-pin-btn">🔢 Usar PIN</button>`;
    } else if (pin_set) {
      mainContent = _pinHTML();
    } else {
      mainContent = _passwordHTML(true);
    }

    overlay.innerHTML = `
      <div class="sec-box">
        <div class="sec-sensitive-icon">💰</div>
        <div class="sec-title">Área Protegida</div>
        <div class="sec-sub">Módulo ` + moduleName + `</div>
        <div class="sec-sensitive-warning">
          🔒 Esta área contém dados financeiros sensíveis.<br>Confirme sua identidade para continuar.
        </div>
        ` + (nome ? `<div class="sec-user-badge">
          <div class="sec-user-av">` + avatar + `</div>
          <div class="sec-user-nm">` + nome + `</div>
        </div>` : '') + `
        <div id="sec-main-content">` + mainContent + `</div>
        <div class="sec-err-msg" id="sec-err-msg"></div>
        <button class="sec-link-btn" id="sec-cancel-sensitive" style="margin-top:12px">
          Cancelar
        </button>
      </div>`;

    document.body.appendChild(overlay);
    _bindLockEvents(true, onSuccess);

    // Cancela
    var cancelBtn = overlay.querySelector('#sec-cancel-sensitive');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        overlay.classList.add('hide');
        setTimeout(function() { overlay.remove(); }, 200);
        // Volta para a página anterior
        if (global.goPage) global.goPage('clientes');
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOAST DE FEEDBACK
  // ═══════════════════════════════════════════════════════════════════════════
  function _secToast(msg, type) {
    var t = document.createElement('div');
    t.className = 'sec-toast ' + (type || '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function() {
      t.style.opacity = '0';
      t.style.transition = 'opacity .3s';
      setTimeout(function() { t.remove(); }, 300);
    }, 2000);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INIT — ponto de entrada principal
  // ═══════════════════════════════════════════════════════════════════════════
  async function init() {
    _injectCSS();
    detectPlatform();

    // Checa se biometria de plataforma realmente está disponível
    if (SEC.isMobile && window.PublicKeyCredential) {
      try {
        SEC.bioSupported = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      } catch(e) {
        SEC.bioSupported = false;
      }
    }

    console.info('[SEC] Módulo de segurança iniciado.',
      SEC.isMobile ? 'Mobile' : 'Web',
      SEC.bioSupported ? '| Biometria: SIM' : '| Biometria: NÃO (usará PIN/senha)');

    _attachActivityListeners();
    _attachVisibilityListener();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTEGRAÇÃO COM O LOGIN EXISTENTE
  // Substitui / envolve as funções do sistema original
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Chamado pelo sistema original após login bem-sucedido (senha).
   * Registra biometria / configura PIN se ainda não foi feito.
   */
  async function onLoginSuccess(userObj) {
    SEC.currentUser  = userObj;
    SEC.sessionActive = true;
    _startInactivityTimer();

    var bio_reg = localStorage.getItem(SEC_CONFIG.LS_KEY_BIO_REG);
    var pin_set = localStorage.getItem(SEC_CONFIG.LS_KEY_PIN);

    if (SEC.isMobile && SEC.bioSupported && !bio_reg) {
      // Primeira vez no celular → registra biometria
      _secToast('🔐 Configurando biometria…', '');
      var ok = await registrarBiometria(userObj.user);
      if (ok) {
        _secToast('✅ Biometria registrada! Próximos acessos serão mais rápidos.', 'success');
      } else {
        // Fallback: configura PIN
        if (!pin_set) {
          setTimeout(function() { _setupPin(function() {}); }, 800);
        }
      }
    } else if (!SEC.isMobile && !pin_set) {
      // Desktop: oferece PIN opcional (melhora UX na inatividade)
      // Não obrigatório no web — usa senha diretamente
    }
  }

  /**
   * Intercepta a navegação para páginas sensíveis.
   * Chame antes de renderizar o módulo financeiro.
   */
  function requireSensitiveAuth(moduleName, onSuccess) {
    if (!SEC.sessionActive) {
      _lockApp('required');
      return;
    }
    _showSensitiveGate(moduleName, onSuccess);
  }

  /**
   * Bloqueia o app manualmente (ex: botão "sair" ou logout).
   */
  function lockNow() {
    SEC.sensitiveUnlocked = false;
    localStorage.removeItem(SEC_CONFIG.LS_KEY_SESSION);
    _lockApp('manual');
  }

  /**
   * Reseta biometria/PIN (útil para testes ou troca de dispositivo).
   */
  function resetSecurityConfig() {
    localStorage.removeItem(SEC_CONFIG.LS_KEY_BIO_REG);
    localStorage.removeItem(SEC_CONFIG.LS_KEY_PIN);
    localStorage.removeItem('ads_cred_id');
    console.info('[SEC] Configuração de segurança resetada.');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // API PÚBLICA
  // ═══════════════════════════════════════════════════════════════════════════
  global.ADSSecurity = {
    init              : init,
    onLoginSuccess    : onLoginSuccess,
    requireSensitive  : requireSensitiveAuth,
    lock              : lockNow,
    reset             : resetSecurityConfig,
    isSessionActive   : function() { return SEC.sessionActive; },
    isMobile          : function() { return SEC.isMobile; },
    hasBiometrics     : function() { return SEC.bioSupported; },
  };

})(window);
