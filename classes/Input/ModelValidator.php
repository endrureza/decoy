<?php namespace Bkwld\Decoy\Input;

// Dependencies
use Bkwld\Decoy\Exceptions\ValidationFail;
use Bkwld\Decoy\Models\Base as BaseModel;
use Bkwld\Library\Laravel\Validator as BkwldLibraryValidator;
use Illuminate\Support\Arr;
use Validator;

/**
 * Validate the attributs of a model
 */
class ModelValidator {

	/**
	 * Validate a model, firing Decoy events
	 *
	 * @param BaseModel $data
	 * @param array     $rules A Laravel rules array. If null, will be pulled from model
	 * @param array     $messages Special error messages
	 * @return Validator
	 */
	public function validate(BaseModel $model, $rules = null, $messages = []) {
		return $this->validateAndPrefixErrors(null, $model);
	}

	/**
	 * Validate a model but prefix any error messages with the provided prefix.
	 * You would do this to make the error messages show up correctely in a
	 * nested model where the input is like <input name="_images[2][file]">
	 *
	 * @param string    $prefix
	 * @param BaseModel $data
	 * @param array     $rules A Laravel rules array. If null, will be pulled from model
	 * @param array     $messages Special error messages
	 * @return Validator
	 *
	 * @throws ValidationFail
	 */
	public function validateAndPrefixErrors($prefix, BaseModel $model,
		$rules = null, $messages = []) {

		// Get the data to validate
		$data = $model->getAttributes();

		// Get rules from model
		if ($rules === null) $rules = $model::$rules;

		// Merge additional messages in
		$messages = array_merge(BkwldLibraryValidator::$messages, $messages);

		// Apply prefixes
		if ($prefix) {
			$data = $this->prefixArrayKeys($prefix, $data);
			$rules = $this->prefixArrayKeys($prefix, $rules);
		}

		// Build the validation instance and fire the intiating event.
		$validator = Validator::make($data, $rules, $messages);
		$model->fireDecoyEvent('validating', [$model, $validator]);

		// Strip the prefix out of error messages
		if ($prefix) $this->removePrefixFromMessages($prefix, $validator);

		// Run the validation.  If it fails, throw an exception that will get
		// handled by Middleware.
		if ($validator->fails()) throw new ValidationFail($validator);

		// Fire completion event
		$model->fireDecoyEvent('validated', [$model, $validator]);
		return $validator;
	}

	/**
	 * Apply a prefix to the keys of an array
	 *
	 * @param string $prefix
	 * @param array  $array
	 * @return array
	 */
	public function prefixArrayKeys($prefix, $array) {
		return array_combine(array_map(function($key) use ($prefix) {
			return $prefix.$key;
		}, array_keys($array)), array_values($array));
	}

	/**
	 * Add replacers to the validator that strip back out the previx
	 *
	 * @param  string $prefix
	 * @param  Illuminate\Validation\Validator $validator
	 * @return void
	 */
	protected function removePrefixFromMessages($prefix, $validator) {

		// Get all the rules in a single flat array
		$rules = Arr::flatten($validator->getRules());

		// Callback that removes isntances of the prefix from a message. Laravel
		// will have already replaced underscores with spaces, so we need to
		// reverse that.
		$prefix = str_replace('_', ' ', $prefix);
		$replacer = function($message) use ($prefix) {
			return str_replace($prefix, '', $message);
		};

		// Create an array of identical replacer functions
		$replacers = array_fill(0, count($rules), $replacer);

		// Add the replacers to the validtor
		$validator->addReplacers(array_combine($rules, $replacers));
	}
}
