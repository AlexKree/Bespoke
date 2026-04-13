(function(){
  const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  document.querySelectorAll("[data-nav]").forEach(a=>{
    const href = (a.getAttribute("href")||"").toLowerCase();
    if(href === here) a.classList.add("active");
  });
})();

(function(){
  var toggle = document.querySelector('.navbar-toggle');
  var menu = document.querySelector('.navbar-menu');
  if(!toggle || !menu) return;

  function openMenu(){
    menu.classList.add('open');
    toggle.classList.add('open');
    toggle.setAttribute('aria-expanded','true');
  }
  function closeMenu(){
    menu.classList.remove('open');
    toggle.classList.remove('open');
    toggle.setAttribute('aria-expanded','false');
  }

  toggle.addEventListener('click', function(e){
    e.stopPropagation();
    if(menu.classList.contains('open')) closeMenu(); else openMenu();
  });

  menu.querySelectorAll('a').forEach(function(a){
    a.addEventListener('click', closeMenu);
  });

  document.addEventListener('click', function(e){
    if(menu.classList.contains('open') && !menu.contains(e.target) && !toggle.contains(e.target)){
      closeMenu();
    }
  });

  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape') closeMenu();
  });
})();
