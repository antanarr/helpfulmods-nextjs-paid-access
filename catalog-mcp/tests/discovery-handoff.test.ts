import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createCatalogHandler } from '../src/index.js';
import { applyCatalogPresentation } from '../src/presentation.js';
import { validateCatalog } from '../src/catalog.js';
import { catalogData } from '../src/catalog.generated.js';

test('anonymous SDK discovers buyer vocabulary, concrete requirements and a payment-free cart handoff', async () => {
 const handler=createCatalogHandler({allowedHosts:['catalog.test'],allowedOrigins:[]});
 const client=new Client({name:'anonymous-buyer',version:'1'});
 try {
  await client.connect(new StreamableHTTPClientTransport(new URL('https://catalog.test/mcp/catalog'),{fetch:async(input,init)=>handler(new Request(input,init))}));
  for(const [query,expected]of [['appointments','booking'],['help desk','support'],['customer support chatbot','website-chat']]) {
   const result=await client.callTool({name:'search_catalog',arguments:{query}});
   assert.equal((result.structuredContent?.mods as {id:string}[])[0]?.id,expected);
  }
  for(const query of ['no-matching-customer-workflow-xyz', '...']) {
   const result=await client.callTool({name:'search_catalog',arguments:{query}});
   assert.equal(result.structuredContent?.total,0);
  }
  for(const id of ['booking','writing','website-chat']) {
   const result=await client.callTool({name:'get_setup_overview',arguments:{id}});
   const requirements=result.structuredContent?.requirements as string[];
   assert(requirements.some(value=>value.includes('Node.js')));
   assert(requirements.some(value=>value.includes(id==='website-chat'?'SQLite':'PostgreSQL 17')));
  }
  const link=await client.callTool({name:'prepare_cart_link',arguments:{productIds:['booking','website-chat']}});
  const value=link.structuredContent!;
  assert.equal(value.url,'https://helpfulmods.com/cart.html?products=booking%2Cwebsite-chat');
  assert.equal(value.financialAuthority,false);assert.equal(value.requiresHumanConfirmation,true);
  for(const productIds of [[],['booking','booking'],['constructor'],['not-a-mod']])assert.equal((await client.callTool({name:'prepare_cart_link',arguments:{productIds}})).isError,true);
  assert.equal((await client.callTool({name:'prepare_cart_link',arguments:{productIds:['booking'],price:1}})).isError,true);
 }finally{await client.close();}
});

test('verified availability and visibility are refreshed through the anonymous HTTP boundary', async () => {
 let visible=true, available=true, held=false;
 const handler=createCatalogHandler({allowedHosts:['catalog.test'],allowedOrigins:[],catalogPresentation:async()=>[
  {productId:'booking',discoverable:visible,purchasable:!held,purchaseAvailable:available},
 ]});
 const client=new Client({name:'current-availability',version:'1'});
 try {
  await client.connect(new StreamableHTTPClientTransport(new URL('https://catalog.test/mcp/catalog'),{fetch:async(input,init)=>handler(new Request(input,init))}));
  const detail=async()=>{
   const result=await client.callTool({name:'get_mod_details',arguments:{id:'booking'}});
   return result.structuredContent?.mod as {status:string;purchaseAvailable:boolean};
  };
  assert.equal((await detail()).status,'available');
  available=false;assert.equal((await detail()).status,'unavailable');
  available=true;held=true;assert.equal((await detail()).purchaseAvailable,false);
  visible=false;
  assert.equal((await client.callTool({name:'prepare_cart_link',arguments:{productIds:['booking']}})).isError,true);
  const search=await client.callTool({name:'search_catalog',arguments:{query:'appointments'}});
  assert(!(search.structuredContent?.mods as {id:string}[]).some(mod=>mod.id==='booking'));
 }finally{await client.close();}
});

test('status follows verified purchase availability, while an owner hold can only restrict it',()=>{
 const base=validateCatalog(catalogData);
 for(const [purchaseAvailable,purchasable,status]of [[true,true,'available'],[false,true,'unavailable'],[true,false,'unavailable']] as const){
  const result=applyCatalogPresentation(base,[{productId:'booking',discoverable:true,purchasable,purchaseAvailable}]);
  assert.equal(result.booking!.status,status);assert.equal(result.booking!.purchaseAvailable,purchaseAvailable&&purchasable);
 }
 assert.equal(applyCatalogPresentation(base,[{productId:'booking',discoverable:true,purchasable:true}]).booking!.status,base.booking!.status);
});
