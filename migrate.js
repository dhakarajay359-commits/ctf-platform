const fs = require('fs');
const glob = require('glob');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');

// Function to process a single file
function processFile(filePath) {
  const code = fs.readFileSync(filePath, 'utf-8');
  
  const ast = parser.parse(code, {
    sourceType: 'module',
    plugins: ['jsx']
  });

  let modified = false;

  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      
      // Look for db.prepare(...).get(), .all(), .run()
      if (
        t.isMemberExpression(callee) &&
        t.isCallExpression(callee.object) &&
        t.isMemberExpression(callee.object.callee) &&
        t.isIdentifier(callee.object.callee.object, { name: 'db' }) &&
        t.isIdentifier(callee.object.callee.property, { name: 'prepare' }) &&
        (t.isIdentifier(callee.property, { name: 'get' }) ||
         t.isIdentifier(callee.property, { name: 'all' }) ||
         t.isIdentifier(callee.property, { name: 'run' }))
      ) {
        // If it's not already awaited, wrap it in await
        if (!t.isAwaitExpression(path.parent)) {
          path.replaceWith(t.awaitExpression(path.node));
          modified = true;
          makeParentsAsync(path);
        }
      }
      
      // Look for db.exec(...)
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: 'db' }) &&
        t.isIdentifier(callee.property, { name: 'exec' })
      ) {
        if (!t.isAwaitExpression(path.parent)) {
          path.replaceWith(t.awaitExpression(path.node));
          modified = true;
          makeParentsAsync(path);
        }
      }
    }
  });

  if (modified) {
    const output = generate(ast, {}, code);
    fs.writeFileSync(filePath, output.code);
    console.log(`Migrated ${filePath}`);
  }
}

// Traverse upwards and add 'async' to enclosing functions
function makeParentsAsync(path) {
  let current = path.parentPath;
  while (current) {
    if (t.isFunctionDeclaration(current.node) || 
        t.isFunctionExpression(current.node) || 
        t.isArrowFunctionExpression(current.node) ||
        t.isObjectMethod(current.node)) {
      if (!current.node.async) {
        current.node.async = true;
      }
      return;
    }
    current = current.parentPath;
  }
}

// Process all files
glob.sync('routes/**/*.js').forEach(processFile);
glob.sync('*.js', { ignore: ['node_modules/**', 'migrate.js', 'db.js'] }).forEach(processFile);
