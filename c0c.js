#!/usr/bin/env node
// c0c.js — Tiny C (subset) compiler + VM in JavaScript (ESM, no deps)
// Features: int-only, functions/params/locals, if/else, while, return,
// break/continue, arithmetic/comparison, expression statements, declarations,
// comments (//, /* */), builtins: puti(int), putc(int), exit(int).
// CLI: node c0c.js file.c  |  node c0c.js --emit file.c
// MIT License. Extend at will. Keep this header if you fork.
//
// ============================= LEXER =============================
class Lexer {
  constructor(src) {
    this.src = src;
    this.i = 0;
    this.line = 1;
    this.col = 1;
    this.tokens = [];
  }
  isAlpha(c){ return /[A-Za-z_]/.test(c); }
  isNum(c){ return /[0-9]/.test(c); }
  isAlnum(c){ return /[A-Za-z0-9_]/.test(c); }
  peek(n=0){ return this.src[this.i+n] ?? '\0'; }
  adv(){ const c = this.src[this.i++] ?? '\0'; if (c === '\n'){ this.line++; this.col=1; } else this.col++; return c; }
  add(type, value=null){ this.tokens.push({type, value, line:this.line, col:this.col}); }
  error(msg){ throw new Error(`Lex error @${this.line}:${this.col} ${msg}`); }
  skipSpaceAndComments() {
    while (true) {
      let c = this.peek();
      // whitespace
      if (/\s/.test(c)){ this.adv(); continue; }
      // // comment
      if (c==='/' && this.peek(1)==='/'){ this.adv(); this.adv(); while(this.peek()!=='\n' && this.peek()!=='\0') this.adv(); continue; }
      // /* */ comment
      if (c==='/' && this.peek(1)==='*'){ this.adv(); this.adv(); while(!(this.peek()==='*' && this.peek(1)==='/')){ if (this.peek()==='\0') this.error('Unclosed block comment'); this.adv(); } this.adv(); this.adv(); continue; }
      break;
    }
  }
  readNumber() {
    let s = '';
    while(this.isNum(this.peek())) s += this.adv();
    // decimal only
    this.add('num', Number(s) | 0);
  }
  readIdent() {
    let s = '';
    while(this.isAlnum(this.peek())) s += this.adv();
    const kw = new Set(['int','return','if','else','while','break','continue','void']);
    if (kw.has(s)) this.add(s);
    else this.add('ident', s);
  }
  readOpOrPunct() {
    const two = this.peek()+this.peek(1);
    const map2 = ['==','!=','<=','>=','&&','||'];
    if (map2.includes(two)){ this.add(two); this.adv(); this.adv(); return; }
    const c = this.adv();
    const singles = '{}()[],;+-*/%<>=!&|';
    if (singles.includes(c)) this.add(c);
    else this.error(`Unexpected char '${c}'`);
  }
  tokenize() {
    while (true){
      this.skipSpaceAndComments();
      const c = this.peek();
      if (c === '\0') break;
      if (this.isAlpha(c)) this.readIdent();
      else if (this.isNum(c)) this.readNumber();
      else this.readOpOrPunct();
    }
    this.add('eof');
    return this.tokens;
  }
}

// ============================= PARSER + CODEGEN =============================
// Bytecode opcodes
const OP = Object.freeze({
  NOP:0, CONST:1, LOAD:2, STORE:3,
  ADD:4, SUB:5, MUL:6, DIV:7, MOD:8,
  LT:9, GT:10, LE:11, GE:12, EQ:13, NEQ:14,
  JUMP:15, JZ:16,
  CALL:17, RET:18,
  POP:19, HALT:20,
  BUILTIN:21,           // arg0: builtin id, arg1: argc
  // For loop control fixups we just use JUMP/JZ patching
});

// Built-in functions registry
const Builtins = [
  { name: 'puti', argc: 1, fn: (args)=>{ process.stdout.write(String((args[0]|0))+'\n'); return 0; } },
  { name: 'putc', argc: 1, fn: (args)=>{ const v = args[0]|0; process.stdout.write(String.fromCharCode(v & 255)); return 0; } },
  { name: 'exit', argc: 1, fn: (args)=>{ const code = args[0]|0; process.exit(Math.max(code,0)); } },
];
const BuiltinMap = Object.fromEntries(Builtins.map((b,i)=>[b.name,i]));

// Function IR container
class Func {
  constructor(name, params){
    this.name = name;
    this.params = params;         // array of param names
    this.locals = new Map();      // name -> index
    this.nlocals = params.length; // params occupy lowest local slots
    params.forEach((p,idx)=>this.locals.set(p, idx));
    this.code = [];               // flat [op,arg,op,arg,...] where most ops have 1 arg (or 0)
    this.labels = [];             // for debugging
  }
  emit(op, arg=0){ this.code.push(op, arg|0); return (this.code.length-2); }
  patch(atIndex, value){ this.code[atIndex+1] = value|0; }
  get pc(){ return (this.code.length/2)|0; }
  ensureLocal(name){
    if (this.locals.has(name)) return this.locals.get(name);
    const idx = this.nlocals++;
    this.locals.set(name, idx);
    return idx;
  }
  localIndex(name){
    if (!this.locals.has(name)) throw new Error(`Unknown variable '${name}' in function ${this.name}`);
    return this.locals.get(name);
  }
}

// Program container
class Program {
  constructor(){ this.funcs = []; this.funcMap = new Map(); }
  addFunc(fn){ if (this.funcMap.has(fn.name)) throw new Error(`Duplicate function '${fn.name}'`); this.funcMap.set(fn.name, this.funcs.length); this.funcs.push(fn); }
  funcIndex(name){ return this.funcMap.has(name) ? this.funcMap.get(name) : -1; }
}

// Pratt parser with direct codegen into current function
class Parser {
  constructor(tokens){
    this.toks = tokens;
    this.i = 0;
    this.prog = new Program();
    this.cur = null; // current Func
    this.loopStack = []; // for break/continue patching
  }
  tok(){ return this.toks[this.i]; }
  is(type){ return this.tok().type === type; }
  val(){ return this.tok().value; }
  eat(type){
    if (!this.is(type)) this.err(`Expected '${type}', got '${this.tok().type}'`);
    const t = this.tok(); this.i++; return t;
  }
  opt(type){ if (this.is(type)){ this.i++; return true; } return false; }
  err(msg){ const t=this.tok(); throw new Error(`Parse error @${t.line}:${t.col} ${msg}`); }

  parseProgram(){
    while(!this.is('eof')){
      this.parseFunction();
    }
    // Ensure main
    if (this.prog.funcIndex('main') === -1)
      throw new Error("No 'main' function found (int main(){...})");
    return this.prog;
  }

  expectTypeAndName(){
    // Accept 'int' or 'void' then ident
    if (this.opt('int')) {/* ok */}
    else if (this.opt('void')) {/* ok, treated as int-returning with ignored value */}
    else this.err("Expected 'int' or 'void'");
    const name = this.eat('ident').value;
    return name;
  }

  parseParamList(){
    const params = [];
    if (this.is(')')) return params;
    while(true){
      if (!this.opt('int')) this.err("Expected 'int' in parameter");
      const id = this.eat('ident').value;
      params.push(id);
      if (!this.opt(',')) break;
    }
    return params;
  }

  parseFunction(){
    const name = this.expectTypeAndName();
    this.eat('(');
    const params = this.parseParamList();
    this.eat(')');
    const fn = new Func(name, params);
    this.cur = fn;
    this.parseBlock();
    // if function didn't end with return, synthesize one (return 0)
    // (C requires return for non-void main; we keep permissive)
    if (fn.code.length === 0 || fn.code[fn.code.length-2] !== OP.RET){
      fn.emit(OP.CONST, 0);
      fn.emit(OP.RET, 0);
    }
    this.prog.addFunc(fn);
    this.cur = null;
  }

  parseBlock(){
    this.eat('{');
    while(!this.opt('}')){
      if (this.is('int')) this.parseDeclaration();
      else this.parseStatement();
    }
  }

  parseDeclaration(){
    this.eat('int');
    // int a;  int a=1, b=2;
    while(true){
      const name = this.eat('ident').value;
      const idx = this.cur.ensureLocal(name);
      if (this.opt('=')){
        this.parseExpr();
        // store into local
        this.cur.emit(OP.STORE, idx);
      } else {
        // default init to 0
        this.cur.emit(OP.CONST, 0);
        this.cur.emit(OP.STORE, idx);
      }
      if (!this.opt(',')) break;
    }
    this.eat(';');
  }

  parseStatement(){
    if (this.opt('{')){ // nested block (no new scope, function-wide vars)
      while(!this.opt('}')){
        if (this.is('int')) this.parseDeclaration();
        else this.parseStatement();
      }
      return;
    }
    if (this.opt('return')){
      // return expr?;
      if (!this.opt(';')){
        this.parseExpr();
        this.eat(';');
      } else {
        this.cur.emit(OP.CONST, 0);
      }
      this.cur.emit(OP.RET, 0);
      return;
    }
    if (this.opt('if')){
      this.eat('('); this.parseExpr(); this.eat(')');
      const jz = this.cur.emit(OP.JZ, 0);
      this.parseStatement();
      if (this.opt('else')){
        const jmp = this.cur.emit(OP.JUMP, 0);
        this.cur.patch(jz, this.cur.pc);
        this.parseStatement();
        this.cur.patch(jmp, this.cur.pc);
      } else {
        this.cur.patch(jz, this.cur.pc);
      }
      return;
    }
    if (this.opt('while')){
      const start = this.cur.pc;
      this.eat('('); this.parseExpr(); this.eat(')');
      const jz = this.cur.emit(OP.JZ, 0);
      this.loopStack.push({start, breaks:[], conts:[]});
      this.parseStatement();
      this.cur.emit(OP.JUMP, start);
      this.cur.patch(jz, this.cur.pc);
      const loop = this.loopStack.pop();
      loop.breaks.forEach(at => this.cur.patch(at, this.cur.pc));
      loop.conts.forEach(at => this.cur.patch(at, start));
      return;
    }
    if (this.opt('break')){
      this.eat(';');
      if (this.loopStack.length===0) this.err('break not in loop');
      const addr = this.cur.emit(OP.JUMP, 0);
      this.loopStack[this.loopStack.length-1].breaks.push(addr);
      return;
    }
    if (this.opt('continue')){
      this.eat(';');
      if (this.loopStack.length===0) this.err('continue not in loop');
      const addr = this.cur.emit(OP.JUMP, 0);
      this.loopStack[this.loopStack.length-1].conts.push(addr);
      return;
    }
    // expression statement
    this.parseExpr();
    this.eat(';');
    this.cur.emit(OP.POP, 0);
  }

  // Expression parsing (Pratt)
  parseExpr(){ this.parseAssign(); }
  parseAssign(){
    // assignment is right-assoc: x = y = 3
    const mark = this.i;
    if (this.is('ident')){
      // Look ahead for '=' not part of '==' and not '(' (call)
      const idTok = this.tok();
      const next = this.toks[this.i+1]?.type;
      if (next === '='){
        // assignment to local
        this.i += 2; // consume ident and '='
        this.parseAssign();
        const idx = this.cur.ensureLocal(idTok.value); // implicit decl? allow? we allow 'int' separately; here ensure so codegen works if user forgot 'int'
        this.cur.emit(OP.STORE, idx);
        // push assigned value result (C yields lvalue->rvalue). We will reload.
        this.cur.emit(OP.LOAD, idx);
        return;
      }
    }
    this.i = mark;
    this.parseBinary(0);
  }

  precedence(op){
    // Higher number => tighter binding
    switch(op){
      case '||': return 1;
      case '&&': return 2;
      case '==': case '!=': return 3;
      case '<': case '<=': case '>': case '>=': return 4;
      case '+': case '-': return 5;
      case '*': case '/': case '%': return 6;
      default: return -1;
    }
  }

  parseUnary(){
    if (this.opt('+')){ this.parseUnary(); return; }
    if (this.opt('-')){ this.parseUnary(); this.cur.emit(OP.CONST, -1); this.cur.emit(OP.MUL, 0); return; }
    if (this.opt('!')){ this.parseUnary(); // !x => (x==0)
      this.cur.emit(OP.CONST, 0); this.cur.emit(OP.EQ, 0); return;
    }
    this.parsePrimary();
  }

  parsePrimary(){
    if (this.is('num')){ const v=this.eat('num').value|0; this.cur.emit(OP.CONST, v); return; }
    if (this.is('ident')){
      const name = this.eat('ident').value;
      if (this.opt('(')){
        // call: gather args
        const args = [];
        if (!this.is(')')){
          while(true){ this.parseExpr(); args.push(0); if (!this.opt(',')) break; }
        }
        this.eat(')');
        // after parsing, args are on stack left-to-right
        const fidx = this.prog.funcIndex(name);
        if (fidx >= 0){
          // user-defined
          this.cur.emit(OP.CALL, fidx);
          // Also store argc in a following CONST for runtime check (compact encoding alternative)
          this.cur.emit(OP.CONST, args.length);
        } else if (name in BuiltinMap){
          this.cur.emit(OP.BUILTIN, BuiltinMap[name]);
          this.cur.emit(OP.CONST, args.length);
        } else {
          this.err(`Unknown function '${name}'`);
        }
        return;
      } else {
        // variable
        const idx = this.cur.localIndex(name);
        this.cur.emit(OP.LOAD, idx);
        return;
      }
    }
    if (this.opt('(')){ this.parseExpr(); this.eat(')'); return; }
    this.err('Expected primary expression');
  }

  parseBinary(minPrec){
    this.parseUnary();
    while(true){
      const t = this.tok().type;
      const prec = this.precedence(t);
      if (prec < minPrec) break;
      // consume operator
      this.i++;
      const nextMin = prec + 1;
      this.parseBinary(nextMin);
      // emit op
      switch(t){
        case '+': this.cur.emit(OP.ADD,0); break;
        case '-': this.cur.emit(OP.SUB,0); break;
        case '*': this.cur.emit(OP.MUL,0); break;
        case '/': this.cur.emit(OP.DIV,0); break;
        case '%': this.cur.emit(OP.MOD,0); break;
        case '<': this.cur.emit(OP.LT,0); break;
        case '>': this.cur.emit(OP.GT,0); break;
        case '<=': this.cur.emit(OP.LE,0); break;
        case '>=': this.cur.emit(OP.GE,0); break;
        case '==': this.cur.emit(OP.EQ,0); break;
        case '!=': this.cur.emit(OP.NEQ,0); break;
        case '&&': // a&&b => (a!=0) && (b!=0) => compute as: a!=0, b!=0, AND -> emulate AND via * (both 0/1)
          this.cur.emit(OP.CONST, 0); this.cur.emit(OP.NEQ,0); // for left
          // right already parsed -> ensure !=0:
          this.cur.emit(OP.CONST, 0); this.cur.emit(OP.NEQ,0);
          this.cur.emit(OP.MUL,0);
          break;
        case '||':
          this.cur.emit(OP.CONST, 0); this.cur.emit(OP.NEQ,0);
          this.cur.emit(OP.CONST, 0); this.cur.emit(OP.NEQ,0);
          // OR -> a+b then clamp to 0/1 via !=0
          this.cur.emit(OP.ADD,0);
          this.cur.emit(OP.CONST,0); this.cur.emit(OP.NEQ,0);
          break;
        default: this.err(`Unhandled operator ${t}`);
      }
    }
  }
}

// ============================= VIRTUAL MACHINE =============================
class VM {
  constructor(program){
    this.prog = program;
    // frame stack of { code, ip, locals:Int32Array, ret?:frame }
    this.frame = null;
    this.stack = []; // value stack
  }

  run(funcName='main'){
    const idx = this.prog.funcIndex(funcName);
    if (idx < 0) throw new Error(`Function '${funcName}' not found`);
    this.callFunctionIndex(idx, 0); // argc=0
    // main loop
    while (this.frame){
      const {code} = this.frame;
      const ip2 = this.frame.ip<<1;
      const op = code[ip2], arg = code[ip2+1]; // encoded as [op,arg]
      this.frame.ip++;
      switch(op){
        case OP.NOP: break;
        case OP.CONST: this.stack.push(arg|0); break;
        case OP.LOAD: this.stack.push(this.frame.locals[arg|0]|0); break;
        case OP.STORE: { const v = this.stack.pop()|0; this.frame.locals[arg|0] = v; } break;
        case OP.ADD: { const b=this.stack.pop()|0, a=this.stack.pop()|0; this.stack.push((a+b)|0); } break;
        case OP.SUB: { const b=this.stack.pop()|0, a=this.stack.pop()|0; this.stack.push((a-b)|0); } break;
        case OP.MUL: { const b=this.stack.pop()|0, a=this.stack.pop()|0; this.stack.push(Math.imul(a,b)); } break;
        case OP.DIV: { const b=this.stack.pop()|0, a=this.stack.pop()|0; if (b===0) throw new Error('Division by zero'); this.stack.push((a/b)|0); } break;
        case OP.MOD: { const b=this.stack.pop()|0, a=this.stack.pop()|0; if (b===0) throw new Error('Modulo by zero'); this.stack.push((a%b)|0); } break;
        case OP.LT: { const b=this.stack.pop()|0, a=this.stack.pop()|0; this.stack.push((a<b)?1:0); } break;
        case OP.GT: { const b=this.stack.pop()|0, a=this.stack.pop()|0; this.stack.push((a>b)?1:0); } break;
        case OP.LE: { const b=this.stack.pop()|0, a=this.stack.pop()|0; this.stack.push((a<=b)?1:0); } break;
        case OP.GE: { const b=this.stack.pop()|0, a=this.stack.pop()|0; this.stack.push((a>=b)?1:0); } break;
        case OP.EQ: { const b=this.stack.pop()|0, a=this.stack.pop()|0; this.stack.push((a===b)?1:0); } break;
        case OP.NEQ:{ const b=this.stack.pop()|0, a=this.stack.pop()|0; this.stack.push((a!==b)?1:0); } break;
        case OP.JUMP: this.frame.ip = arg|0; break;
        case OP.JZ: { const v=this.stack.pop()|0; if (v===0) this.frame.ip = arg|0; } break;
        case OP.CALL: {
          const fidx = arg|0;
          const argc = this.readConstArgAfterCall(); // next word is CONST argc
          const f = this.prog.funcs[fidx];
          this.callFunction(f, argc);
        } break;
        case OP.BUILTIN:{
          const bid = arg|0;
          const argc = this.readConstArgAfterCall();
          const spec = Builtins[bid];
          if (argc !== spec.argc) throw new Error(`Builtin ${spec.name} expects ${spec.argc} args, got ${argc}`);
          const args = new Array(argc);
          for (let i=argc-1;i>=0;i--) args[i] = this.stack.pop()|0;
          const ret = spec.fn(args);
          // push return (int; if fn exits process, no return)
          this.stack.push((ret|0)>>>0|0);
        } break;
        case OP.RET: {
          const retv = this.stack.pop()|0;
          this.frame = this.frame.ret ?? null;
          if (!this.frame){ return retv|0; }
          this.stack.push(retv|0);
        } break;
        case OP.POP: this.stack.pop(); break;
        case OP.HALT: return;
        default: throw new Error(`Bad opcode ${op}`);
      }
    }
  }

  readConstArgAfterCall(){
    // Expect immediate next pair to be CONST argc (emitted by compiler)
    const code = this.frame.code;
    const ip2 = this.frame.ip<<1;
    const op2 = code[ip2], arg2 = code[ip2+1];
    if (op2 !== OP.CONST) throw new Error('Internal: CALL missing argc CONST');
    this.frame.ip++;
    return arg2|0;
  }

  callFunctionIndex(idx, argc){ this.callFunction(this.prog.funcs[idx], argc); }
  callFunction(func, argc){
    // Prepare locals: params first, remaining locals zeroed
    const locals = new Int32Array(func.nlocals|0);
    for (let i=argc-1;i>=0;i--){ locals[i] = this.stack.pop()|0; }
    const frame = { code: func.code, ip:0, locals, ret: this.frame };
    this.frame = frame;
  }
}

// ============================= DRIVER (compile+run) =============================
function compileCtoProgram(source){
  const toks = new Lexer(source).tokenize();
  const parser = new Parser(toks);
  return parser.parseProgram();
}

function runFile(path, emitOnly=false){
  const fs = require('node:fs');
  const src = fs.readFileSync(path,'utf8');
  const prog = compileCtoProgram(src);
  if (emitOnly){
    // Emit minimal JSON of functions and bytecode
    const out = {
      functions: prog.funcs.map((f,idx)=>({
        index: idx,
        name: f.name,
        params: f.params,
        nlocals: f.nlocals,
        code: f.code, // [op,arg,...]
      })),
      opcodes: OP,
    };
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  const vm = new VM(prog);
  const exitCode = vm.run('main')|0;
  // If main returns non-zero, mirror shell behavior by exiting with that code (optional)
  // process.exitCode = exitCode; // comment out to avoid exiting non-zero in pipelines
}

if (require.main === module){
  const args = process.argv.slice(2);
  if (args.length === 0){
    console.error('Usage: node c0c.js [--emit] file.c');
    process.exit(1);
  }
  const emit = args[0] === '--emit';
  const file = emit ? args[1] : args[0];
  if (!file){ console.error('Missing input file'); process.exit(1); }
  runFile(file, emit);
}

// ============================= QUICK SELF-TEST (optional) =============================
// To run: node c0c.js (no args) -> will show usage.
// You can temp-uncomment below to sanity check without a .c file.
/*
const demo = `
int add(int a,int b){ return a+b; }
int main(){
  int i=0, s=0;
  while(i<10){
    s = add(s,i);
    if (i==5) { puti(s); }
    i = i + 1;
  }
  puti(s);
  return 0;
}`;
const prog = compileCtoProgram(demo);
const vm = new VM(prog);
vm.run('main'); // expect: 10 then 45 on separate lines
*/
