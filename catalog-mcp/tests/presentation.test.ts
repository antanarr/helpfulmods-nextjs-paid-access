import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCatalogHandler } from '../src/index.js';
import { catalogData, sourceSha256 } from '../src/catalog.generated.js';
import { validateCatalog } from '../src/catalog.js';
import { applyCatalogPresentation } from '../src/presentation.js';

test('owner presentation is typed and cannot alter source financial facts or add arbitrary products',()=>{
 const base=validateCatalog(catalogData);
 const view=applyCatalogPresentation(base,[{productId:'blog',discoverable:true,purchasable:false,name:'Updated Blog',summary:'Approved owner copy',demoUrl:'https://demo.example.test/blog'}]);
 assert.equal(view.blog!.name,'Updated Blog');assert.equal(view.blog!.description,'Approved owner copy');
 assert.equal(view.blog!.price,base.blog!.price);assert.equal(view.blog!.version,base.blog!.version);assert.equal(view.blog!.newCheckoutHeld,true);
 assert.equal(base.blog!.name,'Blog & SEO Publishing');
 assert.throws(()=>applyCatalogPresentation(base,[{productId:'arbitrary',discoverable:true,purchasable:true}]));
 assert.throws(()=>applyCatalogPresentation(base,[{productId:'blog',discoverable:true,purchasable:true},{productId:'blog',discoverable:false,purchasable:false}]));
 assert.throws(()=>applyCatalogPresentation(base,JSON.parse('[{"productId":"blog","discoverable":true,"purchasable":true,"price":1}]')));
 assert.throws(()=>applyCatalogPresentation(base,[{productId:'blog',discoverable:true,purchasable:true,demoUrl:'javascript:alert(1)'}]));
});

test('SDK handshake and tool listing avoid live reads while product requests honor owner controls',async()=>{
 let discoverable=true,held=false,reads=0;
 const base=validateCatalog(catalogData);
 const handler=createCatalogHandler({allowedHosts:['catalog.test'],allowedOrigins:[],catalogPresentation:async ids=>{
  reads++;assert.equal(ids.length,25);return [{productId:'blog',discoverable,purchasable:!held,name:'Owner Blog',summary:'ownercontrolneedle20261031 approved guide',demoUrl:'https://demo.example.test/blog'}];
 }});
 const client=new Client({name:'owner-catalog-regression',version:'1'});
 const transport=new StreamableHTTPClientTransport(new URL('https://catalog.test/mcp/catalog'),{fetch:async(input,init)=>handler(new Request(input,init))});
 try{
  await client.connect(transport);
  const tools=await client.listTools();
  assert.equal(tools.tools.length,5);
  assert.equal(reads,0);
  const search=await client.callTool({name:'search_catalog',arguments:{query:'ownercontrolneedle20261031'}});
  assert.ok(search.structuredContent);const mods=search.structuredContent.mods;assert.ok(Array.isArray(mods));assert.equal(mods.length,1);
  const details=await client.readResource({uri:'helpfulmods://mods/blog'});const mod=JSON.parse(String(details.contents[0]!.text)).mod;
  assert.equal(mod.name,'Owner Blog');assert.equal(mod.price,base.blog!.price);assert.equal(mod.version,base.blog!.version);
  discoverable=false;
  const resources=await client.listResources();assert.ok(!resources.resources.some(row=>row.uri==='helpfulmods://mods/blog'));
  assert.equal((await client.callTool({name:'get_mod_details',arguments:{id:'blog'}})).isError,true);
  assert.equal((await client.callTool({name:'get_setup_overview',arguments:{id:'blog'}})).isError,true);
  await assert.rejects(client.readResource({uri:'helpfulmods://mods/blog'}));
  const aggregate=await client.readResource({uri:'helpfulmods://catalog'});assert.ok(!JSON.parse(String(aggregate.contents[0]!.text)).mods.some((row:{id:string})=>row.id==='blog'));
  discoverable=true;held=true;
  const returned=await client.callTool({name:'get_mod_details',arguments:{id:'blog'}});assert.equal((returned.structuredContent?.mod as {newCheckoutHeld:boolean}).newCheckoutHeld,true);
  assert.equal(returned.structuredContent?.sourceSha256,sourceSha256);assert.ok(reads>=8);
 }finally{await client.close();}
});
