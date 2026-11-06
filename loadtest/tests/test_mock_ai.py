"""Runs the mock-AI contract test as part of the local suite."""
import importlib.util
import warnings
from pathlib import Path

warnings.simplefilter("ignore", ResourceWarning)
_p = Path(__file__).resolve().parents[1] / "mock-ai" / "contract_test.py"
_spec = importlib.util.spec_from_file_location("mock_ai_contract_test", _p)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

ContractTest = _mod.ContractTest
FaultTest = _mod.FaultTest
FaultMatrix = _mod.FaultMatrix
