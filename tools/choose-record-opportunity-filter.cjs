// Drive the same check-list/apply interaction as a user; no private filter mutation.
module.exports=async function chooseOpportunityFilter(page,kind,values){
 await page.locator('#recordOpportunity'+kind).click();
 const all=values==='all'||values==='';
 const action=page.locator(all?'#recordOpportunitySelectAll':'#recordOpportunityClearAll');if(await action.isEnabled())await action.click();
 if(!all)for(const value of Array.isArray(values)?values:values==='sun,moon'?['sun','moon']:[values])await page.locator('#recordOpportunityPickerList input[value="'+value+'"]').check();
 await page.locator('#recordOpportunityPickerApply').click();await page.locator('#recordOpportunityPicker').waitFor({state:'detached'});
};
