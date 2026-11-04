import json, os
here = os.path.dirname(os.path.abspath(__file__))
src = lambda f: open(os.path.join(here, 'src', f)).read()
eng = src('engine.js').replace("if (typeof module !== 'undefined') module.exports", "if (typeof module !== 'undefined' && module.exports) module.exports")
names = json.load(open(os.path.join(here, 'src', 'cardnames.json')))
names.update({'back-mine': ['The mine', 'Card back'], 'back-tools_red': ['Red tools', 'Card back'], 'back-tools_blue': ['Blue tools', 'Card back']})
page = src('template.html').replace('/*TUTORIAL*/', src('tutorial.js')).replace('/*ENGINE*/', eng).replace('/*NAMES*/', json.dumps(names, ensure_ascii=False)).replace('/*UI*/', src('ui.js'))
open(os.path.join(here, 'artifact.html'), 'w').write(page)
# index.html is the standalone page for hosting; artifact.html is the same page without the document skeleton
open(os.path.join(here, 'index.html'), 'w').write("<!doctype html>\n<html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1, viewport-fit=cover'>\n" + page.replace('<style>', '<style>\n[hidden]{display:none!important}', 1).replace('<header', '</head><body>\n<header', 1) + "\n</body></html>\n")
# tutorial.html is the animated tutorial on its own page
open(os.path.join(here, 'tutorial.html'), 'w').write(src('tutorial_page.html').replace('/*TUTORIAL*/', src('tutorial.js')))
print(len(page))
