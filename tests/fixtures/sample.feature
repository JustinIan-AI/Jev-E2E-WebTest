# ai-testgen → IDWTH 衔接测试夹具
# 含 ready（含 Scenario Outline）与 draft（未映射步骤）两类场景。
@regression
Feature: Account and Catalog

  Background:
    Given I navigate to https://staging.example.com/login

  @smoke
  Scenario: Operator logs in
    Given fill in "email field" with "operator@example.com"
    And fill in "password field" with "s3cret"
    When click "login submit button"
    Then I should see the welcome banner
    And I should see 3 nav items
    But I should not see the login form

  Scenario: Operator uploads avatar
    When I upload a profile picture
    Then I should see the upload success toast

  Scenario: Operator closes all sessions
    When I terminate all active sessions
    Then the session risk badge is cleared

  @positive
  Scenario Outline: Search products
    Given fill in "search box" with "<keyword>"
    When click "search button"
    Then I should see <count> product cards

    Examples:
      | keyword   | count |
      | laptop    | 2     |
      | keyboard  | 5     |
