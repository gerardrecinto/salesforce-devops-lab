public with sharing class AccountHealthController {
    @AuraEnabled(cacheable=true)
    public static List<Account> getStaleAccounts(Integer staleDays) {
        return AccountHealthService.findStale(staleDays);
    }
}
