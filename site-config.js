(()=>{
  const runtime = (window.OLDKOWEB_RUNTIME_CONFIG && typeof window.OLDKOWEB_RUNTIME_CONFIG === 'object') ? window.OLDKOWEB_RUNTIME_CONFIG : {};
  window.OLDKOWEB_CONFIG = Object.freeze({
    playUrl: 'https://play.oldkoweb.com/',
    accountApiBase: '/api/account',
    rankingsApiBase: '/api/rankings',
    statusApiBase: '/api/status',
    openingAt: null,
    showCountdown: false,
    ...runtime
  });
})();
