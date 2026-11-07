// HappyCoding pet sprite set. Local pxl source; outputs are copied into the
// widget asset catalog. Palette follows the app icon: mint cat, purple ink,
// gold star crown.
pal({
  k: "#2b2140",
  m: "#8fe6c8",
  M: "#d6fff1",
  d: "#4fae93",
  p: "#6b4bd6",
  y: "#ffd15c",
  w: "#ffffff",
  e: "#2b2140",
  r: "#ff8fb1",
  o: "#ff9f43",
  b: "#8ecbff",
})

sprite("cat_base", { w: 32, h: 32, outline: "k" },
  // tail
  ellipse(27, 24, 3, 6, "m"),
  // body
  ellipse(16, 24, 8, 7, "m"),
  ellipse(16, 25, 5, 5, "M"),
  // head
  ellipse(16, 13, 10, 9, "m"),
  // ears
  poly([6, 9, 8, 1, 13, 7], "m"),
  poly([26, 9, 24, 1, 19, 7], "m"),
  poly([8, 8, 9, 4, 11, 7], "r"),
  poly([24, 8, 23, 4, 21, 7], "r"),
  // face
  rect(11, 12, 2, 3, "e"),
  rect(19, 12, 2, 3, "e"),
  px(11, 12, "w"),
  px(19, 12, "w"),
  px(16, 16, "r"),
  px(15, 17, "r"),
  px(17, 17, "r"),
  // paws
  ellipse(10, 29, 3, 2, "M"),
  ellipse(22, 29, 3, 2, "M"),
  // crown star
  poly([16, 1, 17, 3, 19, 3, 18, 5, 18, 7, 16, 6, 14, 7, 14, 5, 13, 3, 15, 3], "y")
)

sprite("cat_happy", { base: "cat_base", w: 32, h: 32 },
  // connected waving arm
  poly([23, 21, 25, 17, 28, 17, 28, 20, 25, 22], "m"),
  ellipse(27, 17, 2, 2, "M"),
  // blush
  px(10, 17, "r"),
  px(22, 17, "r")
)

sprite("cat_working", { base: "cat_base", w: 32, h: 32 },
  // little laptop
  rect(9, 27, 14, 3, "d"),
  rect(10, 24, 12, 3, "b"),
  rect(11, 25, 10, 1, "M"),
  // focused brows
  hline(11, 11, 2, "e"),
  hline(19, 11, 2, "e")
)

sprite("cat_attention", { base: "cat_base", w: 32, h: 32 },
  // alert badge above the right ear
  circ(28, 5, 3, "o"),
  rect(27, 3, 2, 2, "w"),
  px(27, 6, "w"),
  // raised brows
  hline(10, 11, 3, "e"),
  hline(19, 11, 3, "e")
)

sprite("cat_completed", { base: "cat_base", w: 32, h: 32 },
  // raised arms and confetti
  poly([9, 22, 5, 18, 8, 16, 11, 21], "m"),
  ellipse(5, 18, 2, 2, "M"),
  poly([23, 22, 27, 18, 24, 16, 21, 21], "m"),
  ellipse(27, 18, 2, 2, "M"),
  px(3, 8, "y"), px(7, 5, "r"), px(25, 6, "b"), px(29, 11, "y"),
  px(4, 27, "p"), px(28, 28, "o")
)

sprite("cat_sleeping", { base: "cat_base", w: 32, h: 32 },
  // clear the open eyes, then draw closed lids
  rect(10, 11, 4, 4, "m"),
  rect(18, 11, 4, 4, "m"),
  hline(11, 13, 2, "e"),
  hline(19, 13, 2, "e"),
  px(16, 16, "r"),
  // z marks
  line(24, 8, 27, 8, "b"), line(27, 8, 24, 11, "b"), line(24, 11, 27, 11, "b"),
  line(28, 3, 30, 3, "b"), line(30, 3, 28, 5, "b"), line(28, 5, 30, 5, "b")
)

sheet("cats", ["cat_happy", "cat_working", "cat_attention", "cat_completed", "cat_sleeping"], { cols: 5, pad: 2 })
