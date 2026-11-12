#!/bin/sh
# 重新產生 ../tailwind.css (Tailwind 編譯 + 深色模式規則)
# 需要 Node.js 與 Python 3；第一次請先在此資料夾執行：npm install
set -e
cd "$(dirname "$0")"
npx tailwindcss -c tailwind.config.js -i in.css -o ../tailwind.css --minify
node -e "const c=require('tailwindcss/colors');const f='slate gray red orange amber yellow lime green emerald teal cyan sky blue indigo violet purple fuchsia pink rose'.split(' ');const o={};f.forEach(k=>o[k]=Object.assign({},c[k]));console.log(JSON.stringify(o))" > colors.json
python3 gen_dark.py .. colors.json >> ../tailwind.css
echo "OK: ../tailwind.css"
