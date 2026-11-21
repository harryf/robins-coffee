# Menu seasons, drink pages and recipes

21 November 2026. The owner asked for seasons, a page per drink (people search for cocktails to make at home), what drinking it is like, ingredients in metric measures, short steps and several pictures per drink.

## Drinks in one list, seasons name them

`menu.yml` holds `seasons:` and `drinks:`. A season names its drinks by slug. A drink is written once.

Why not drinks inside seasons: the bar plans a year of cocktails and replaces one or two at a time, so a drink comes back. Inside seasons it would be copied, and a fixed recipe or a new photo would have to be typed twice. With one list there is one recipe and one page (`/menu/<slug>/`), and the page lists every season the drink was in. In the Studio a drink's form has a tick box per season, which is how a drink moves or joins.

A drink's slug is made from its first name and stays, so its address does not change when it is renamed.

## Which season the site shows

The one running today in Zürich (first and last day both count; when two overlap, the one that started last). Between seasons: the one that ended last. Before the first: the first to come. So the menu is never empty by the calendar alone.

## Nothing invented

Measures and steps stay empty until the bar gives them. A drink page shows only the parts that exist, and carries schema.org Recipe data only when it has ingredients.

Claude drafted the "what it is like" texts and the first season's description from the ingredients and the menu cards. They carry `draft:` in the file: the Studio marks them for Elias and drops the mark when he saves; the site shows the text without a mark.

## Pictures

The drawings were square cuts of the printed menu cards and lost the garnish and the foot of the glass. They are cut again from the cards as 4:5 portraits with room above and below, and are always shown whole (`object-fit: contain` on the drawing's own dark), never as a square cut. The first picture of a drink is the drawing; more pictures are real photos and open in the gallery lightbox.
