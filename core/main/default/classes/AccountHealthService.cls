public with sharing class AccountHealthService {
    public static final Integer DEFAULT_STALE_DAYS = 90;
    public static final Integer MAX_ROWS = 200;

    public static Boolean isStale(Account a, Date today, Integer staleDays) {
        if (a.LastActivityDate == null) {
            return true;
        }
        return a.LastActivityDate < today.addDays(-staleDays);
    }

    public static List<Account> findStale(Integer staleDays) {
        Integer days = (staleDays == null ||
            staleDays < 1)
            ? DEFAULT_STALE_DAYS
            : staleDays;
        return AccountSelector.staleAccounts(
            Date.today().addDays(-days),
            MAX_ROWS
        );
    }
}
