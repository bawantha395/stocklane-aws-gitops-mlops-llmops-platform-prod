import {UserManager, WebStorageStateStore} from 'oidc-client-ts';
declare global {interface Window {STOCKLANE_CONFIG:{authMode:string;authority:string;clientId:string;scope:string;apiBase?:string;logoutUrl?:string}}}
export const config=window.STOCKLANE_CONFIG;
export const auth=config.authMode==='cognito'?new UserManager({authority:config.authority,client_id:config.clientId,redirect_uri:location.origin+'/auth/callback',post_logout_redirect_uri:location.origin,response_type:'code',scope:config.scope,userStore:new WebStorageStateStore({store:sessionStorage}),automaticSilentRenew:true}):null;
export async function headers(){
 const result:Record<string,string>={};
 if(auth){const user=await auth.getUser();if(user&&!user.expired)result.Authorization='Bearer '+user.access_token;}
 else result['X-Demo-User']=localStorage.getItem('stocklane.role')||'owner';
 return result;
}
/** Shrink a photo before upload: Lambda accepts at most 6 MB per request, and the server resizes to 1600 px anyway. */
export async function shrink(file:File):Promise<File>{
 if(file.size<1_500_000&&file.type==='image/jpeg')return file;
 try{
  const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
  const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  canvas.getContext('2d')?.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  const blob=await new Promise<Blob|null>(done=>canvas.toBlob(done,'image/jpeg',0.9));
  return blob?new File([blob],'part.jpg',{type:'image/jpeg'}):file;
 }catch{return file;}
}
export class ApiError extends Error { constructor(message:string,public status:number){super(message);this.name="ApiError";} }
export async function api<T=any>(path:string,options:RequestInit={},key?:string):Promise<T>{
 const h=new Headers(await headers());new Headers(options.headers).forEach((v,k)=>h.set(k,v));
 if(options.body&&!(options.body instanceof FormData))h.set('Content-Type','application/json');
 if(key)h.set('Idempotency-Key',key);
 let response:Response;try{response=await fetch((config.apiBase||'')+path,{...options,headers:h});}catch{throw new ApiError('No connection. Nothing was lost, check the network and try again.',0);}
 if(!response.ok){let message='The service is unavailable. Keep this form open and retry.';try{const e=await response.json();message=e.message||e.detail||message;}catch{/* keep safe fallback */}if(response.status===401)message='Sign in to continue.';throw new ApiError(message,response.status);}
 if(response.status===204)return undefined as T;
 return response.json();
}
async function pdfBlob(path:string,name:string):Promise<{blob:Blob;name:string}>{
 const file=await api<{filename?:string;pdf:string}>(path);
 const bytes=Uint8Array.from(atob(file.pdf),c=>c.charCodeAt(0));
 return {blob:new Blob([bytes],{type:'application/pdf'}),name:file.filename||name};
}
/** Save a PDF from the API. It travels as JSON, so it behaves like every other call (auth, errors, retries). */
export async function download(path:string,name:string){
 const {blob,name:file}=await pdfBlob(path,name);
 const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=file;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
/** Open a PDF in a new tab so the browser's own viewer can print it on A4. */
export async function openPdf(path:string,name:string){
 const tab=window.open('','_blank');
 try{
  const {blob}=await pdfBlob(path,name);const url=URL.createObjectURL(blob);
  if(tab)tab.location.href=url;else{const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';document.body.appendChild(a);a.click();a.remove();}
  setTimeout(()=>URL.revokeObjectURL(url),120000);
 }catch(e){tab?.close();throw e;}
}
export type Product={id:string;sku:string;name:string;category:string;brand:string;grade:string;capacity:string;barcode:string|null;unit:string;quantity:number;selling_price:number;reorder_level:number;image_id:string|null};
export type Job={id:string;customer:string;vehicle:string;registration:string;phone:string;summary:string;status:string;created_at:string};
export type Movement={id:string;product_id:string;sku:string;name:string;unit:string;kind:string;quantity:number;unit_price:number;balance?:number;job_id:string|null;issue_id:string|null;actor:string;receiver_name?:string|null;note:string;created_at:string};
export type Draft={id:string;image_id:string;fields:Record<string,string>;suggestions?:Record<string,string>;labelSuggestions?:Record<string,string>;ai?:{status:string;code?:string;message?:string};source:string;status:string;created_at:string;product_id:string|null;captureId?:string};
export type Invoice={id:string;job_id:string;invoice_number:string;labour:number;total:number;created_at:string};
export type Match={identifiedProductId?:string;qrValue?:string;imageId:string;state:string;modelVersion:string;candidates:{product:Product;imageId:string;similarity:number;sameSkuEstimate?:number|null}[];message:string};
export type BarcodeLookup={barcode:string;found:boolean;suggestions:Record<string,string>};
export function csv(name:string,rows:Record<string,unknown>[]){if(!rows.length)return;const keys=Object.keys(rows[0]);const escape=(x:unknown)=>'"'+String(x??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';const blob=new Blob([[keys.map(escape).join(','),...rows.map(r=>keys.map(k=>escape(r[k])).join(','))].join('\r\n')],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}


export async function signOut(){await auth?.removeUser();if(config.logoutUrl)location.assign(config.logoutUrl+'?client_id='+encodeURIComponent(config.clientId)+'&logout_uri='+encodeURIComponent(location.origin));else if(auth)await auth.signoutRedirect();}
