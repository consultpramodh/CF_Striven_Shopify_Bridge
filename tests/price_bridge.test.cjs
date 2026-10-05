// JavaScript / Node.js — isolated Apps Script regression tests; no live writes.
const fs=require('fs'),vm=require('vm'),assert=require('assert');
let tests=0;
function test(name,fn){fn();tests++;console.log('PASS '+name);}
class Range{
 constructor(sh,r,c,n=1,m=1){Object.assign(this,{sh,r,c,n,m});}
 getValues(){return Array.from({length:this.n},(_,i)=>Array.from({length:this.m},(_,j)=>this.sh.data[this.r-1+i]?.[this.c-1+j]??''));}
 getDisplayValues(){return this.getValues().map(r=>r.map(String));}
 setValues(rows){for(let i=0;i<rows.length;i++){this.sh.data[this.r-1+i]??=[];for(let j=0;j<rows[i].length;j++)this.sh.data[this.r-1+i][this.c-1+j]=rows[i][j];}return this;}
 setValue(v){return this.setValues(Array.from({length:this.n},()=>Array(this.m).fill(v)));}
 clearContent(){return this.setValue('');}setFontWeight(){return this;}insertCheckboxes(){return this.setValue(false);}
}
class Sheet{constructor(data=[]){this.data=data;}getDataRange(){return this.getRange(1,1,Math.max(this.data.length,1),Math.max(this.getLastColumn(),1));}getRange(...a){return new Range(this,...a);}getMaxRows(){return 1000;}getMaxColumns(){return 26;}insertRowsAfter(){}insertColumnsAfter(){}getLastRow(){return this.data.length;}getLastColumn(){return Math.max(0,...this.data.map(r=>r.length));}clearContents(){this.data=[];}setFrozenRows(){}autoResizeColumns(){}appendRow(r){this.data.push(r);}}
const props={PRICE_BRIDGE_SOURCE_STATE:'COMPLETE',PRICE_BRIDGE_SOURCE_COMPLETED_AT:new Date(Date.now()-10000).toISOString(),STRIVEN_ACCESS_TOKEN:'mock',STRIVEN_REPORT_URL:'https://api.striven.com/v2/reports/mock'};
let sheets={},csvExports=0;
const propertyApi={getProperty:k=>props[k]??null,setProperty(k,v){props[k]=v;},deleteProperty(k){delete props[k];},setProperties(o){Object.assign(props,o);}};
const ss={getSheetByName:n=>sheets[n]||null,insertSheet(n){return sheets[n]=new Sheet();},toast(){}};
const ctx={console,Logger:{log(){}},Date,Number,Set,Map,JSON,PropertiesService:{getScriptProperties:()=>propertyApi},SpreadsheetApp:{getActiveSpreadsheet:()=>ss,getActive:()=>ss,flush(){}},LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})},Utilities:{sleep(){}},getValidStrivenToken_:()=> 'mock',exportSheetToCsv_(){csvExports++;},UrlFetchApp:{fetch(){throw Error('unexpected network');}}};
vm.createContext(ctx);
for(const f of ['variance.gs','shopify_price_import.gs','items.gs'])vm.runInContext(fs.readFileSync(__dirname+'/../replacements/'+f,'utf8'),ctx);
const sourceHeader=['ItemNumber','Price','MAPPricing'];
const publicHeader=['ProductID','VariantID','ProductTitle','VariantTitle','SKU','Price','CompareAtPrice','Available','Handle','ProductURL'];
const adminHeader=['Handle','Title','Variant SKU','Variant Price','Option1 Name','Option1 Value','Status'];
function setup(striven,pub,admin=[]){sheets={Striven_Items:new Sheet([sourceHeader,...striven]),Shopify_products_public:new Sheet([publicHeader,...pub]),Shopify_products:new Sheet([adminHeader,...admin]),Variance:new Sheet()};props.PRICE_BRIDGE_SOURCE_STATE='COMPLETE';props.PRICE_BRIDGE_SOURCE_COMPLETED_AT=new Date(Date.now()-10000).toISOString();}
function candidate(sku='A',price=100,compare='',available=true,id=11,handle='a'){return [1,id,sku,'',sku,price,compare,available,handle,''];}
function rows(){return sheets.Variance.data.slice(1);}
function build(){ctx.buildVarianceSheet_FromPublic();}
test('Unavailable public variant remains eligible',()=>{setup([['A',200,'']],[candidate('A',100,'',false)]);build();assert.equal(rows().length,1);});
test('Sale variant excluded',()=>{setup([['A',200,'']],[candidate('A',100,150)]);build();assert.equal(rows().length,0);});
test('MAP-first retained',()=>{setup([['A',200,175]],[candidate()]);build();assert.equal(rows()[0][24],175);});
test('Zero MAP never yields a zero target',()=>{setup([['A',200,0]],[candidate()]);build();assert.equal(rows().length,0);});
test('Bad numeric text is NaN',()=>{assert(Number.isNaN(ctx.priceBridgeNumber_('N/A')));assert(Number.isNaN(ctx.priceBridgeNumber_('   ')));assert.equal(ctx.priceBridgeNumber_('$1,200.50'),1200.5);assert(Number.isNaN(ctx.priceBridgeNumber_('abc123')));});
test('Duplicate Striven SKU cannot choose first price',()=>{setup([['A',200,''],['A',300,'']],[candidate()]);build();assert.equal(rows().length,0);});
test('Biggest gaps sorted first',()=>{setup([['A',200,''],['B',500,'']],[candidate(),candidate('B',400,'',true,22,'b')]);build();assert.equal(rows()[0][8],100);setup([['A',300,''],['B',500,'']],[candidate(),candidate('B',400,'',true,22,'b')]);build();assert.equal(rows()[0][0],'A');});
test('One cent difference excluded',()=>{setup([['A',100.01,'']],[candidate()]);build();assert.equal(rows().length,0);});
test('Incomplete source blocks calculations',()=>{props.PRICE_BRIDGE_SOURCE_STATE='REFRESHING';assert.throws(()=>build(),/fresh Striven/);});
test('Unchecked rows not exported',()=>{setup([['A',200,'']],[candidate()],[['a','A','A',100,'Title','Default Title','active']]);build();ctx.enrichVarianceIdentifiersFromAdminExport_();ctx.buildShopifyPriceImportSheet();assert.equal(sheets.Shopify_Price_Import.data.length,1);});
test('Checked unique identity exported; compare-at not overwritten',()=>{sheets.Variance.data[1][23]=true;ctx.buildShopifyPriceImportSheet();assert.equal(sheets.Shopify_Price_Import.data.length,2);assert(!sheets.Shopify_Price_Import.data[0].includes('Variant Compare At Price'));assert.equal(sheets.Shopify_Price_Import.data[1][9],'200.00');});
test('Duplicate SKU selects exact product handle',()=>{setup([['A',200,'']],[candidate()],[['b','Other','A',100,'Title','Default Title','active'],['a','A','A',100,'Title','Default Title','active']]);build();ctx.enrichVarianceIdentifiersFromAdminExport_();assert.equal(rows()[0][11],'a');});
test('CSV preserves source SKU capitalization',()=>{setup([['abc',200,'']],[candidate('abc',100,'',true,11,'abc')],[['abc','A','abc',100,'Title','Default Title','active']]);build();ctx.enrichVarianceIdentifiersFromAdminExport_();sheets.Variance.data[1][23]=true;ctx.buildShopifyPriceImportSheet();assert.equal(sheets.Shopify_Price_Import.data[1][8],'abc');});
test('Same-handle duplicate SKU options ambiguous',()=>{setup([['A',200,'']],[candidate()],[['a','A','A',100,'Color','Red','active'],['a','A','A',100,'Color','Blue','active']]);build();ctx.enrichVarianceIdentifiersFromAdminExport_();assert.equal(rows()[0][11],'');assert.match(rows()[0][28],/Ambiguous/);});
test('CSV blocks target manipulation',()=>{setup([['A',200,'']],[candidate()],[['a','A','A',100,'Title','Default Title','active']]);build();ctx.enrichVarianceIdentifiersFromAdminExport_();rows()[0][23]=true;sheets.Variance.data[1][23]=true;sheets.Variance.data[1][24]=999;assert.throws(()=>ctx.buildShopifyPriceImportSheet(),/Target differs/);assert.equal(sheets.Shopify_Price_Import?.data.length || 0,0);});
test('Missing checkbox column fails closed',()=>{setup([['A',200,'']],[candidate()],[['a','A','A',100,'Title','Default Title','active']]);build();sheets.Variance.data[0][23]='Wrong';assert.throws(()=>ctx.buildShopifyPriceImportSheet(),/Update Shopify/);});
let live={id:'gid://shopify/ProductVariant/11',sku:'A',price:'100',compareAtPrice:null,product:{id:'gid://shopify/Product/1',status:'ACTIVE'}};let writes=0;
ctx.priceBridgeReadVariant_=()=>({...live});ctx.priceBridgeGraphql_=(q,v)=>{writes++;live.price=v.variants[0].price;return {productVariantsBulkUpdate:{productVariants:[{id:live.id,price:live.price}],userErrors:[]}};};
test('Live identity mismatch blocks write',()=>{assert.throws(()=>ctx.shopifyUpdateVariantPrice_(11,200,{sku:'WRONG',currentPrice:100}),/SKU changed/);assert.equal(writes,0);});
test('Live sale blocks write',()=>{live.compareAtPrice='150';assert.throws(()=>ctx.shopifyUpdateVariantPrice_(11,200,{sku:'A',currentPrice:100}),/on sale/);live.compareAtPrice=null;});
test('Concurrent live price change blocks write',()=>{live.price='120';assert.throws(()=>ctx.shopifyUpdateVariantPrice_(11,200,{sku:'A',currentPrice:100}),/price changed/);live.price='100';});
test('Successful write is read back',()=>{ctx.shopifyUpdateVariantPrice_(11,200,{sku:'A',currentPrice:100});assert.equal(writes,1);assert.equal(live.price,'200.00');});
test('Retry after successful write avoids second mutation',()=>{ctx.shopifyUpdateVariantPrice_(11,200,{sku:'A',currentPrice:100});assert.equal(writes,1);});
// Exercise actual resume logic with fake clock advancing during a report fetch.
const RealDate=Date;let clock=Date.now();class FakeDate extends RealDate{constructor(...a){super(...(a.length?a:[clock]));}static now(){return clock;}}
ctx.Date=FakeDate;let pages=[];
ctx.UrlFetchApp.fetch=url=>{const page=Number(url.match(/pageindex=(\d+)/)[1]);pages.push(page);if(page===0 && pages.length===2)clock+=90000;return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({data:page===0?[{ItemNumber:'A',Price:200}]:[]})};};
test('Pause flushes page and preserves published source',()=>{sheets.Striven_Items=new Sheet([['ItemNumber','Price'],['OLD',1]]);ctx.pullStrivenReport_Items_ToSheet_RESUMABLE(true,100000);assert.equal(props.INV_SYNC_PAGEINDEX,'1');assert.equal(props.INV_SYNC_TOTALROWS,'1');assert.equal(sheets.Striven_Items_Refresh.data[1][0],"'A");assert.equal(sheets.Striven_Items.data[1][0],'OLD');assert.equal(props.PRICE_BRIDGE_SOURCE_STATE,'REFRESHING');});
test('Resume publishes completed snapshot without missing page',()=>{ctx.pullStrivenReport_Items_ToSheet_RESUMABLE(false,100000);assert.equal(sheets.Striven_Items.data.length,2);assert.equal(sheets.Striven_Items.data[1][0],"'A");assert.equal(props.PRICE_BRIDGE_SOURCE_STATE,'COMPLETE');assert.equal(props.INV_SYNC_PAGEINDEX,undefined);assert.deepEqual(pages,[0,0,1]);});
test('Malformed report response preserves previous snapshot',()=>{ctx.UrlFetchApp.fetch=()=>({getResponseCode:()=>200,getContentText:()=>'{"error":"bad"}'});assert.throws(()=>ctx.pullStrivenReport_Items_ToSheet_RESUMABLE(true),/missing data array/);assert.equal(sheets.Striven_Items.data[1][0],"'A");assert.equal(props.PRICE_BRIDGE_SOURCE_STATE,'ERROR');});
ctx.Date=RealDate;
test('Stale snapshot blocks use',()=>{props.PRICE_BRIDGE_SOURCE_STATE='COMPLETE';props.PRICE_BRIDGE_SOURCE_COMPLETED_AT=new Date(Date.now()-25*3600000).toISOString();assert.throws(()=>ctx.priceBridgeRequireCompleteSource_(),/fresh Striven/);});
test('Shopify mutation userErrors fail the row',()=>{live.price='100';ctx.priceBridgeGraphql_=()=>({productVariantsBulkUpdate:{userErrors:[{message:'Denied'}]}});assert.throws(()=>ctx.shopifyUpdateVariantPrice_(11,200,{sku:'A',currentPrice:100}),/rejected/);});
test('Unverified mutation outcome is not marked successful',()=>{ctx.priceBridgeGraphql_=()=>({productVariantsBulkUpdate:{userErrors:[],productVariants:[]}});assert.throws(()=>ctx.shopifyUpdateVariantPrice_(11,200,{sku:'A',currentPrice:100}),/could not be verified/);});
test('Archived live product blocked',()=>{live.product.status='ARCHIVED';assert.throws(()=>ctx.shopifyUpdateVariantPrice_(11,200,{sku:'A',currentPrice:100}),/not active/);live.product.status='ACTIVE';});
console.log('TOTAL '+tests+' passed');
