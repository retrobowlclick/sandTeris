document.addEventListener("DOMContentLoaded", function () {
  !(function (e) {
    var t = document.createElement("style");
    (t.type = "text/css"),
      t.styleSheet
        ? (t.styleSheet.cssText = e)
        : t.appendChild(document.createTextNode(e));
    document.getElementsByTagName("head")[0].appendChild(t);
  })(
    "#button {\n  display:none;\n}\n.imgb_vis {\n  animation: imgb-animation 7s linear;\n}\n@keyframes imgb-animation {\n  10% {\n    transform: translateX(0);\n  }\n  20% {\n    transform: translateX(100px);\n  }\n  90% {\n    transform: translateX(100px);\n  }\n  100% {\n    transform: translateX(0);\n  }\n}"
  );
  var e = document.createElement("div");
  (e.id = "button"),
    (e.className = "imgb"),
    (e.style = "position:fixed;top:10%;left:-100px;z-index:10"),
    (e.innerHTML =
      '<a target="_blank" href="https://sites.google.com/site/classroom6x/" title="More of best Classroom 6x Unblocked Games"><img src="https://lh4.googleusercontent.com/lUEWrXMVEr4AdjKISyJahDRJ61bwfvHdpeYm86Djn5U8oCm9dI60NGXSBqad9HUvzTXgqlkosA_hWV-VuXPjzrkGvh3_kNSgYk8ySWzXnDpbBCBiooyBbU8oBy3YBZMDkW8RcRVmDuC0raoeqZBm8kBlqs6c5mdfkJeN2aE68lXS_lcOZ5_F7lIuM6qLVg" width="100" height="30" style="cursor:pointer;" alt="More Unblocked Games 6x"></a>'),
    document.body.appendChild(e);
  var t = document.getElementById("button"),
    n = 0,
    o = ["block", "none"],
    a = [7e3, 16e4];
  !(function e() {
    n ^= 1;
    t.style.display = o[n];
    setTimeout(e, a[n]);
  })(),
    document.querySelector(".imgb").classList.add("imgb_vis");
});