CREATE TABLE Employee (
    EMP_ID INT PRIMARY KEY,
    EMP_NAME VARCHAR(100) NOT NULL,
    SALARY NUMERIC(10,2),
    DEPARTMENT_NAME VARCHAR(100)
);
CREATE OR REPLACE PROCEDURE Insert_Employee(
    IN p_EMP_ID INT,
    IN p_EMP_NAME VARCHAR(100),
    IN p_SALARY NUMERIC(10,2),
    IN p_DEPARTMENT_NAME VARCHAR(100)
) LANGUAGE plpgsql
AS $$
BEGIN
    IF p_EMP_ID % 2 = 0 THEN
        RAISE EXCEPTION 'Even EMP_ID is not allowed. Only odd EMP_ID is allowed.';
    ELSE
        INSERT INTO Employee (
            EMP_ID,
            EMP_NAME,
            SALARY,
            DEPARTMENT_NAME
        )
        VALUES (
            p_EMP_ID,
            p_EMP_NAME,
            p_SALARY,
            p_DEPARTMENT_NAME
        );
        RAISE NOTICE 'Employee inserted successfully. EMP_ID: %', p_EMP_ID;
    END IF;
END;
$$;