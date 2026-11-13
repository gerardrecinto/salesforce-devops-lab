@IsTest
private class AccountHealthServiceTest {
    @TestSetup
    static void setup() {
        List<Account> rows = new List<Account>();
        for (Integer i = 0; i < 200; i++) {
            rows.add(new Account(Name = 'Bulk ' + i));
        }
        insert rows;
    }

    @IsTest
    static void isStaleTreatsMissingActivityAsStale() {
        Account a = new Account(Name = 'No activity');
        System.assertEquals(
            true,
            AccountHealthService.isStale(a, Date.today(), 90),
            'null LastActivityDate counts as stale'
        );
    }

    @IsTest
    static void findStaleReturnsAtMostMaxRows() {
        Test.startTest();
        List<Account> found = AccountHealthService.findStale(90);
        Test.stopTest();
        System.assertEquals(
            AccountHealthService.MAX_ROWS,
            found.size(),
            'result is capped at MAX_ROWS'
        );
    }

    @IsTest
    static void invalidDaysFallBackToDefault() {
        System.assertEquals(
            AccountHealthService.findStale(null).size(),
            AccountHealthService.findStale(0).size(),
            'null and 0 days both use the default'
        );
    }

    @IsTest
    static void controllerDelegatesToService() {
        System.assertEquals(
            AccountHealthService.findStale(30).size(),
            AccountHealthController.getStaleAccounts(30).size(),
            'controller returns what the service returns'
        );
    }

    @IsTest
    static void userWithoutPermissionSetCannotQuery() {
        User u = new User(
            Alias = 'nops',
            Email = 'nops@example.com',
            EmailEncodingKey = 'UTF-8',
            LastName = 'NoPerms',
            LanguageLocaleKey = 'en_US',
            LocaleSidKey = 'en_US',
            ProfileId = [
                SELECT Id
                FROM Profile
                WHERE Name = 'Minimum Access - Salesforce'
                LIMIT 1
            ]
            .Id,
            TimeZoneSidKey = 'America/Los_Angeles',
            UserName = 'nops' + DateTime.now().getTime() + '@example.com'
        );
        insert u;
        System.runAs(u) {
            try {
                AccountHealthService.findStale(90);
                System.assert(false, 'expected a security exception');
            } catch (QueryException e) {
                System.assert(
                    e.getMessage().contains('Account'),
                    e.getMessage()
                );
            }
        }
    }
}
