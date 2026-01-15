(function(){
  const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
  document.querySelectorAll("[data-nav]").forEach(a=>{
    const href = (a.getAttribute("href")||"").toLowerCase();
    if(href === here) a.classList.add("active");
  });
})();
