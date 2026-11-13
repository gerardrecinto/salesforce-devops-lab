public with sharing class AccountSelector {
    public static List<Account> staleAccounts(Date cutoff, Integer maxRows) {
        return [
            SELECT Id, Name, Industry, LastActivityDate
            FROM Account
            WHERE LastActivityDate = NULL OR LastActivityDate < :cutoff
            WITH USER_MODE
            ORDER BY LastActivityDate ASC NULLS FIRST, Name
            LIMIT :maxRows
        ];
    }
}
